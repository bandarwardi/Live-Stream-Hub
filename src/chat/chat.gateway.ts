import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UseGuards, Logger } from '@nestjs/common';
import { WsJwtGuard } from './guards/ws-jwt.guard';
import { ChatService } from './chat.service';
import { BroadcastsService } from '../broadcasts/broadcasts.service';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { ConversationsService } from './conversations.service';
import { FirebaseService } from '../firebase/firebase.service';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({ cors: { origin: '*' } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);

  // Keep track of rate limits: socketId -> lastMessageTimestamp
  private rateLimits = new Map<string, number>();

  // Maps socketId -> { broadcastId, userId }
  private broadcasterSockets = new Map<
    string,
    { broadcastId: string; userId: string }
  >();

  // Maps broadcastId -> active disconnect timer reference
  private disconnectTimers = new Map<string, NodeJS.Timeout>();

  // Maps userId -> socketId for direct real-time events (calls, DMs)
  private userSockets = new Map<string, string>();

  constructor(
    private readonly chatService: ChatService,
    private readonly broadcastsService: BroadcastsService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly conversationsService: ConversationsService,
    private readonly firebaseService: FirebaseService,
  ) {
    this.broadcastsService.onZombieCleanup = (broadcastIds) => {
      broadcastIds.forEach((id) => {
        this.server?.to(id).emit('broadcastEnded', { reason: 'timeout' });
      });
    };

    this.broadcastsService.onBroadcastEnded = (
      broadcastId,
      reason,
      broadcasterId,
    ) => {
      if (this.disconnectTimers.has(broadcastId)) {
        clearTimeout(this.disconnectTimers.get(broadcastId));
        this.disconnectTimers.delete(broadcastId);
      }

      this.logger.log(
        `Emitting broadcastEnded for ${broadcastId} (reason: ${reason})`,
      );

      // 1. Emit to all room participants (viewers & host)
      this.server?.to(broadcastId).emit('broadcastEnded', {
        broadcastId,
        reason: reason || 'ended',
      });

      // 2. Also directly inform the broadcaster socket if connected
      if (broadcasterId) {
        const broadcasterSocketId = this.userSockets.get(broadcasterId);
        if (broadcasterSocketId) {
          this.server?.to(broadcasterSocketId).emit('broadcastEnded', {
            broadcastId,
            reason: reason || 'ended',
          });
        }
      }
    };
  }

  async handleConnection(client: Socket) {
    try {
      // Manual verification on connection to drop unauthorized sockets immediately
      const authHeader =
        client.handshake.auth?.token || client.handshake.headers?.authorization;
      if (!authHeader) {
        client.disconnect();
        return;
      }
      const token =
        authHeader.split(' ').length === 2
          ? authHeader.split(' ')[1]
          : authHeader;
      const secret = this.configService.get<string>('JWT_ACCESS_SECRET');
      const payload = this.jwtService.verify(token, { secret });
      const user = await this.usersService.findById(payload.sub);
      if (!user) {
        client.disconnect();
        return;
      }
      client.data.user = {
        userId: payload.sub,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      };
      this.userSockets.set(payload.sub, client.id);
      this.logger.log(`Client connected: ${client.id} (${user.username})`);
    } catch (error) {
      this.logger.error(
        `Connection failed for client ${client.id}: ${error.message}`,
      );
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    this.rateLimits.delete(client.id);

    if (client.data?.user?.userId) {
      this.userSockets.delete(client.data.user.userId);
    }

    const broadcasterInfo = this.broadcasterSockets.get(client.id);

    if (!broadcasterInfo) {
      // This was a viewer — no special handling needed
      // (socket.io automatically removes them from all rooms)
      return;
    }

    // Clean up the socket tracking entry
    this.broadcasterSockets.delete(client.id);

    const { broadcastId } = broadcasterInfo;
    const TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

    // Update DB status to disconnected and record timestamp
    await this.broadcastsService.markDisconnected(broadcastId);

    // Notify all viewers
    this.server
      .to(broadcastId)
      .emit('broadcasterDisconnected', { timeoutMs: TIMEOUT_MS });

    // Start the auto-end timer
    const timer = setTimeout(async () => {
      this.disconnectTimers.delete(broadcastId);
      await this.broadcastsService.endBroadcast(broadcastId);
      // Notify all waiting viewers so they can navigate away
      this.server
        .to(broadcastId)
        .emit('broadcastEnded', { reason: 'broadcaster_timeout' });
    }, TIMEOUT_MS);

    this.disconnectTimers.set(broadcastId, timer);
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('joinRoom')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody('broadcastId') broadcastId: string,
  ) {
    try {
      const broadcast = await this.broadcastsService.findById(broadcastId);
      if (!broadcast) {
        throw new WsException('Broadcast not found');
      }
      if (!broadcast.isLive) {
        throw new WsException('Broadcast is ended');
      }

      client.join(broadcastId);

      // Store the current room in socket data so we know where they are
      client.data.currentRoom = broadcastId;

      const user = client.data.user;

      const broadcasterId =
        (broadcast.broadcaster as any)._id?.toString() ||
        broadcast.broadcaster.toString();
      const isBroadcaster = user.userId === broadcasterId;

      if (isBroadcaster) {
        this.broadcasterSockets.set(client.id, {
          broadcastId,
          userId: user.userId,
        });

        // If a timer is already running (broadcaster returning), cancel it
        if (this.disconnectTimers.has(broadcastId)) {
          clearTimeout(this.disconnectTimers.get(broadcastId));
          this.disconnectTimers.delete(broadcastId);

          // Update DB status back to live
          await this.broadcastsService.updateStatus(broadcastId, 'live');

          // Notify all viewers the broadcaster is back
          this.server.to(broadcastId).emit('broadcasterReconnected');
        }
      }

      // Send recent messages to the newly joined client
      const recentMessages =
        await this.chatService.getRecentMessages(broadcastId);
      client.emit('recentMessages', recentMessages);

      // Create a system message (not saved to DB to save space, just emitted)
      const joinMessage = {
        _id: `sys-${Date.now()}-${client.id}`,
        sender: user,
        text: `${user.displayName} joined the stream`,
        type: 'system',
        createdAt: new Date().toISOString(),
      };

      // Broadcast system message to everyone in the room EXCEPT the sender
      client.to(broadcastId).emit('newMessage', joinMessage);

      // Update viewer count (socket.io adapter rooms)
      this.updateViewerCount(broadcastId);

      return { status: 'joined', broadcastId };
    } catch (error) {
      this.logger.error(`Join room failed: ${error.message}`);
      client.emit('error', error.message);
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('leaveRoom')
  async handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody('broadcastId') broadcastId: string,
  ) {
    client.leave(broadcastId);
    if (client.data.currentRoom === broadcastId) {
      client.data.currentRoom = null;
    }
    this.updateViewerCount(broadcastId);

    // Optional: send leave system message
    const leaveMessage = {
      _id: `sys-${Date.now()}-${client.id}`,
      sender: client.data.user,
      text: `${client.data.user.displayName} left the stream`,
      type: 'system',
      createdAt: new Date().toISOString(),
    };
    this.server.to(broadcastId).emit('newMessage', leaveMessage);
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody('broadcastId') broadcastId: string,
    @MessageBody('text') text: string,
  ) {
    try {
      // 1. Rate Limiting: 1 message per second
      const now = Date.now();
      const lastMsgTime = this.rateLimits.get(client.id) || 0;
      if (now - lastMsgTime < 1000) {
        throw new WsException(
          'You are sending messages too fast. Please wait.',
        );
      }
      this.rateLimits.set(client.id, now);

      // 2. Validate Room & Broadcast Status
      const broadcast = await this.broadcastsService.findById(broadcastId);
      if (!broadcast || !broadcast.isLive) {
        throw new WsException(
          'Cannot send message: Broadcast is ended or not found',
        );
      }

      // 3. Save Message
      const user = client.data.user;
      const savedMessage = await this.chatService.saveMessage(
        broadcastId,
        user.userId,
        text,
      );

      // 4. Broadcast to Room
      this.server.to(broadcastId).emit('newMessage', savedMessage);

      return { status: 'sent' };
    } catch (error) {
      this.logger.error(`Send message failed: ${error.message}`);
      client.emit('error', error.message);
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('sendGift')
  async handleSendGift(
    @ConnectedSocket() client: Socket,
    @MessageBody('broadcastId') broadcastId: string,
    @MessageBody('gift')
    gift: {
      id: string;
      name: string;
      price: number;
      icon: string;
      animationUrl?: string;
    },
  ) {
    try {
      const user = client.data.user;

      // Deduct coins from sender
      const hasEnoughCoins = await this.usersService.deductCoins(
        user.userId,
        gift.price,
      );
      if (!hasEnoughCoins) {
        client.emit('error', 'رصيدك غير كافٍ لإرسال هذه الهدية');
        return { status: 'error', message: 'Insufficient coins' };
      }

      // Add coins & diamonds to broadcaster
      const broadcast = await this.broadcastsService.findById(broadcastId);
      if (broadcast && broadcast.broadcaster) {
        const broadcasterId =
          (broadcast.broadcaster as any)._id || broadcast.broadcaster;
        await this.usersService.addCoins(broadcasterId.toString(), gift.price);
        await this.usersService.addDiamonds(broadcasterId.toString(), gift.price);
      }

      // Emit gift event to everyone in the room (including the sender, so they see the animation)
      this.server.to(broadcastId).emit('giftReceived', {
        sender: user,
        gift,
        timestamp: new Date().toISOString(),
      });

      // Optionally send a system message to chat
      const giftMessage = {
        _id: `gift-${Date.now()}-${client.id}`,
        sender: user,
        text: `Sent a ${gift.name} ${gift.icon}`,
        type: 'gift',
        gift,
        createdAt: new Date().toISOString(),
      };
      this.server.to(broadcastId).emit('newMessage', giftMessage);

      return { status: 'sent' };
    } catch (error) {
      this.logger.error(`Send gift failed: ${error.message}`);
      client.emit('error', error.message);
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('sendReaction')
  async handleSendReaction(
    @ConnectedSocket() client: Socket,
    @MessageBody('broadcastId') broadcastId: string,
  ) {
    // We don't need strict validation here to keep reactions fast
    // We can just emit to the room (excluding sender, or including sender - usually excluding to let local UI handle its own)
    client.to(broadcastId).emit('reactionReceived', {
      senderId: client.data.user?.userId,
      timestamp: Date.now(),
    });
  }

  private updateViewerCount(broadcastId: string) {
    const room = this.server.sockets.adapter.rooms.get(broadcastId);
    const viewerCount = room ? room.size : 0;
    this.server.to(broadcastId).emit('viewerCount', viewerCount);
  }

  // --- DIRECT MESSAGING EVENTS ---

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('joinConversation')
  async handleJoinConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody('conversationId') conversationId: string,
  ) {
    try {
      const user = client.data.user;
      const conversation = await (
        this.conversationsService as any
      ).conversationModel.findById(conversationId);
      if (!conversation) {
        client.emit('error', 'المحادثة غير موجودة');
        return { status: 'error', message: 'Conversation not found' };
      }

      const isParticipant = conversation.participants.some(
        (p) => p.toString() === user.userId,
      );
      if (!isParticipant) {
        client.emit('error', 'غير مصرح لك بالانضمام لهذه المحادثة');
        return { status: 'error', message: 'Unauthorized' };
      }

      const roomName = `conv-${conversationId}`;
      client.join(roomName);

      // Store current DM room
      client.data.currentDmRoom = roomName;

      return { status: 'joined', conversationId };
    } catch (error) {
      client.emit('error', error.message);
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('leaveConversation')
  async handleLeaveConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody('conversationId') conversationId: string,
  ) {
    const roomName = `conv-${conversationId}`;
    client.leave(roomName);
    if (client.data.currentDmRoom === roomName) {
      client.data.currentDmRoom = null;
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('sendDirectMessage')
  async handleSendDirectMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      conversationId: string;
      type: string;
      text?: string;
      mediaUrl?: string;
      giftData?: any;
    },
  ) {
    try {
      const user = client.data.user;

      // Handle gift deduction
      if (payload.type === 'gift' && payload.giftData) {
        const hasEnoughCoins = await this.usersService.deductCoins(
          user.userId,
          payload.giftData.price,
        );
        if (!hasEnoughCoins) {
          client.emit('error', 'رصيدك غير كافٍ لإرسال هذه الهدية');
          return { status: 'error', message: 'Insufficient coins' };
        }

        // Find recipient to add coins
        // We will fetch the conversation to find the other participant
        // This is handled in the service but we need to do it here for coins
        // Actually, we can fetch conversation first
      }

      // Save message
      const savedMessage = await this.conversationsService.saveMessage({
        conversationId: payload.conversationId,
        senderId: user.userId,
        type: payload.type,
        text: payload.text,
        mediaUrl: payload.mediaUrl,
        giftData: payload.giftData,
      });

      // Get conversation once for recipient logic
      const conversation = await (
        this.conversationsService as any
      ).conversationModel.findById(payload.conversationId);
      const recipientId = conversation?.participants
        .find((p) => p.toString() !== user.userId)
        ?.toString();

      // Add coins & diamonds to recipient if it's a gift
      if (payload.type === 'gift' && payload.giftData && recipientId) {
        await this.usersService.addCoins(recipientId, payload.giftData.price);
        await this.usersService.addDiamonds(recipientId, payload.giftData.price);
      }

      const roomName = `conv-${payload.conversationId}`;

      // Emit to the sender and recipient if they are in the room
      this.server.to(roomName).emit('newDirectMessage', savedMessage);

      // Send Push Notification to the OTHER participant
      if (recipientId) {
        const recipient = await this.usersService.findById(recipientId);
        if (recipient && recipient.pushToken) {
          // Check if recipient is currently in the room using socket.io adapter
          const socketsInRoom = await this.server.in(roomName).fetchSockets();
          const isRecipientInRoom = socketsInRoom.some(
            (s) => s.data.user?.userId === recipientId,
          );

          if (!isRecipientInRoom) {
            // Send push notification
            let body = payload.text || '';
            if (payload.type === 'image') body = '📸 أرسل لك صورة';
            if (payload.type === 'video') body = '🎥 أرسل لك فيديو';
            if (payload.type === 'audio') body = '🎵 أرسل لك رسالة صوتية';
            if (payload.type === 'gift')
              body = `🎁 أرسل لك هدية ${payload.giftData?.name}`;

            await this.firebaseService.sendPushNotification(
              recipient.pushToken,
              user.displayName,
              body,
              {
                type: 'direct_message',
                conversationId: payload.conversationId,
              },
            );
          }
        }
      }

      return { status: 'sent', message: savedMessage };
    } catch (error) {
      this.logger.error(`Send DM failed: ${error.message}`);
      client.emit('error', error.message);
    }
  }

  // --- HELPER METHODS FOR OTHER SERVICES ---

  emitToUser(userId: string, event: string, payload: any) {
    const socketId = this.userSockets.get(userId.toString());
    if (socketId) {
      this.server.to(socketId).emit(event, payload);
      return true;
    }
    return false;
  }

  isUserConnected(userId: string): boolean {
    return this.userSockets.has(userId.toString());
  }
}

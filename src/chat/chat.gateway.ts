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
import { LevelsService } from '../levels/levels.service';
import { VoiceRoomsService } from '../voice-rooms/voice-rooms.service';
import { TransactionsService } from '../transactions/transactions.service';

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

  // Voice rooms tracking
  private voiceHostSockets = new Map<
    string,
    { roomId: string; userId: string }
  >();
  private voiceDisconnectTimers = new Map<string, NodeJS.Timeout>();
  // roomId -> Map<userId, { user: any; totalCoins: number }>
  private voiceRoomLeaderboards = new Map<
    string,
    Map<string, { user: any; totalCoins: number }>
  >();

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
    private readonly levelsService: LevelsService,
    private readonly voiceRoomsService: VoiceRoomsService,
    private readonly transactionsService: TransactionsService,
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

    // Voice Room Callbacks
    this.voiceRoomsService.onZombieCleanup = (roomIds) => {
      roomIds.forEach((id) => {
        this.server?.to(`voice-${id}`).emit('voiceRoomEnded', {
          roomId: id,
          reason: 'timeout',
        });
      });
    };

    this.voiceRoomsService.onVoiceRoomEnded = (roomId, reason, hostId) => {
      if (this.voiceDisconnectTimers.has(roomId)) {
        clearTimeout(this.voiceDisconnectTimers.get(roomId));
        this.voiceDisconnectTimers.delete(roomId);
      }
      this.logger.log(`Emitting voiceRoomEnded for ${roomId} (${reason})`);
      this.server?.to(`voice-${roomId}`).emit('voiceRoomEnded', {
        roomId,
        reason: reason || 'ended',
      });
      if (hostId) {
        const hostSocketId = this.userSockets.get(hostId);
        if (hostSocketId) {
          this.server?.to(hostSocketId).emit('voiceRoomEnded', {
            roomId,
            reason: reason || 'ended',
          });
        }
      }
      this.voiceRoomLeaderboards.delete(roomId);
    };

    this.voiceRoomsService.onSeatsUpdated = (roomId, seats) => {
      this.server?.to(`voice-${roomId}`).emit('seatsUpdated', {
        roomId,
        seats,
      });
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

    // Handle regular broadcaster disconnect
    const broadcasterInfo = this.broadcasterSockets.get(client.id);
    if (broadcasterInfo) {
      this.broadcasterSockets.delete(client.id);
      const { broadcastId } = broadcasterInfo;
      const TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

      await this.broadcastsService.markDisconnected(broadcastId);
      this.server
        .to(broadcastId)
        .emit('broadcasterDisconnected', { timeoutMs: TIMEOUT_MS });

      const timer = setTimeout(async () => {
        this.disconnectTimers.delete(broadcastId);
        await this.broadcastsService.endBroadcast(broadcastId);
        this.server
          .to(broadcastId)
          .emit('broadcastEnded', { reason: 'broadcaster_timeout' });
      }, TIMEOUT_MS);

      this.disconnectTimers.set(broadcastId, timer);
    }

    // Handle voice room host disconnect
    const voiceHostInfo = this.voiceHostSockets.get(client.id);
    if (voiceHostInfo) {
      this.voiceHostSockets.delete(client.id);
      const { roomId } = voiceHostInfo;
      const TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

      await this.voiceRoomsService.markDisconnected(roomId);
      this.server
        .to(`voice-${roomId}`)
        .emit('voiceHostDisconnected', { timeoutMs: TIMEOUT_MS });

      const timer = setTimeout(async () => {
        this.voiceDisconnectTimers.delete(roomId);
        await this.voiceRoomsService.endRoom(roomId, undefined, 'host_timeout');
        this.server
          .to(`voice-${roomId}`)
          .emit('voiceRoomEnded', { roomId, reason: 'host_timeout' });
      }, TIMEOUT_MS);

      this.voiceDisconnectTimers.set(roomId, timer);
    }

    // Handle voice room guest leaving seat on disconnect
    if (client.data?.currentVoiceRoom && client.data?.user?.userId) {
      const vRoomId = client.data.currentVoiceRoom;
      const vUserId = client.data.user.userId;
      this.voiceRoomsService.findById(vRoomId).then((vRoom) => {
        if (vRoom && vRoom.isLive) {
          const seat = vRoom.seats.find(
            (s) => s.userId && s.userId.toString() === vUserId,
          );
          if (seat && seat.index !== 0) {
            this.voiceRoomsService.leaveSeat(vRoomId, seat.index, vUserId);
          }
        }
      }).catch(() => {});
      this.updateVoiceRoomViewerCount(vRoomId);
    }
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

      // Fetch full user profile to get activeEntryEffect
      const fullUser = await this.usersService.findById(user.userId);

      // Create a system message (not saved to DB to save space, just emitted)
      const joinMessage = {
        _id: `sys-${Date.now()}-${client.id}`,
        sender: {
          ...user,
          levelBadgeUrl: fullUser?.levelBadgeUrl || null,
          currentLevel: fullUser?.currentLevel || 1,
          activeFrame: fullUser?.activeFrame || null,
        },
        text: `${user.displayName} joined the stream`,
        type: 'system',
        createdAt: new Date().toISOString(),
      };

      // Broadcast system message to everyone in the room EXCEPT the sender
      client.to(broadcastId).emit('newMessage', joinMessage);

      // Fire entry effect if the user has one equipped
      if (fullUser?.activeEntryEffect) {
        client.to(broadcastId).emit('userEntryEffect', {
          user: {
            _id: user.userId,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
            currentLevel: fullUser.currentLevel || 1,
            levelBadgeUrl: fullUser.levelBadgeUrl || null,
          },
          entryEffectId: fullUser.activeEntryEffect,
          timestamp: new Date().toISOString(),
        });
      }

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
        client.emit('error', 'Insufficient coins to send this gift');
        return { status: 'error', message: 'Insufficient coins' };
      }

      // Add coins & diamonds to broadcaster
      const broadcast = await this.broadcastsService.findById(broadcastId);
      if (broadcast && broadcast.broadcaster) {
        const broadcasterId =
          (broadcast.broadcaster as any)._id || broadcast.broadcaster;
        await this.usersService.addCoins(broadcasterId.toString(), gift.price);
        await this.usersService.addDiamonds(broadcasterId.toString(), gift.price);

        // Grant XP to broadcaster (3 XP per coin received - Bigo Live style)
        try {
          const hostXPResult = await this.levelsService.processXPGain(
            broadcasterId.toString(),
            gift.price * 3,
            'receive_gift',
          );
          if (hostXPResult?.leveledUp && hostXPResult.newLevel) {
            const hostSocketId = this.userSockets.get(broadcasterId.toString());
            if (hostSocketId) {
              this.server.to(hostSocketId).emit('levelUp', {
                userId: broadcasterId.toString(),
                newLevel: hostXPResult.newLevel,
                rewards: hostXPResult.rewards,
              });
            }
            this.server.to(broadcastId).emit('userLevelUp', {
              user: {
                _id: broadcasterId,
                level: hostXPResult.newLevel.level,
                badgeUrl: hostXPResult.newLevel.badgeUrl,
              },
              newLevel: hostXPResult.newLevel,
            });
          }
        } catch (xpErr) {
          this.logger.warn(`Broadcaster XP gain failed: ${xpErr.message}`);
        }
      }

      // Grant XP to sender (1 XP per coin spent)
      try {
        const senderXPResult = await this.levelsService.processXPGain(
          user.userId,
          gift.price * 1,
          'send_gift',
        );
        if (senderXPResult?.leveledUp && senderXPResult.newLevel) {
          client.emit('levelUp', {
            userId: user.userId,
            newLevel: senderXPResult.newLevel,
            rewards: senderXPResult.rewards,
          });
          this.server.to(broadcastId).emit('userLevelUp', {
            user: {
              ...user,
              level: senderXPResult.newLevel.level,
              badgeUrl: senderXPResult.newLevel.badgeUrl,
            },
            newLevel: senderXPResult.newLevel,
          });
        }
      } catch (xpErr) {
        this.logger.warn(`Sender XP gain failed: ${xpErr.message}`);
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
        client.emit('error', 'Conversation not found');
        return { status: 'error', message: 'Conversation not found' };
      }

      const isParticipant = conversation.participants.some(
        (p) => p.toString() === user.userId,
      );
      if (!isParticipant) {
        client.emit('error', 'Unauthorized to join this conversation');
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
        const giftCost = Number(
          payload.giftData.totalPrice ||
            (payload.giftData.price * (payload.giftData.count || 1)) ||
            payload.giftData.price ||
            0,
        );
        const hasEnoughCoins = await this.usersService.deductCoins(
          user.userId,
          giftCost,
        );
        if (!hasEnoughCoins) {
          client.emit('error', 'Insufficient coins to send this gift');
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
        const giftCost = Number(
          payload.giftData.totalPrice ||
            (payload.giftData.price * (payload.giftData.count || 1)) ||
            payload.giftData.price ||
            0,
        );
        await this.usersService.addCoins(recipientId, giftCost);
        await this.usersService.addDiamonds(recipientId, giftCost);
        try {
          await this.usersService.addXP(user.userId, giftCost);
        } catch (xpErr) {}
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
            if (payload.type === 'image') body = '📸 Sent you an image';
            if (payload.type === 'video') body = '🎥 Sent you a video';
            if (payload.type === 'audio') body = '🎵 Sent you a voice message';
            if (payload.type === 'gift')
              body = `🎁 Sent you a gift: ${payload.giftData?.name}`;

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

  // --- VOICE ROOM EVENTS ---

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('joinVoiceRoom')
  async handleJoinVoiceRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody('roomId') roomId: string,
  ) {
    try {
      const room = await this.voiceRoomsService.findById(roomId);
      if (!room || !room.isLive) {
        throw new WsException('Voice room not found or ended');
      }

      const roomChannel = `voice-${roomId}`;
      client.join(roomChannel);
      client.data.currentVoiceRoom = roomId;

      const user = client.data.user;
      const hostId =
        (room.host as any)?._id?.toString() || room.host?.toString();
      const isHost = user.userId === hostId;

      if (isHost) {
        this.voiceHostSockets.set(client.id, {
          roomId,
          userId: user.userId,
        });

        // Cancel disconnect timer if reconnecting
        if (this.voiceDisconnectTimers.has(roomId)) {
          clearTimeout(this.voiceDisconnectTimers.get(roomId));
          this.voiceDisconnectTimers.delete(roomId);
          await this.voiceRoomsService.updateStatus(roomId, 'live');
          this.server
            .to(roomChannel)
            .emit('voiceHostReconnected', { roomId });
        }
      }

      // Update viewer count
      this.updateVoiceRoomViewerCount(roomId);

      // Get current leaderboard
      const roomLb = this.voiceRoomLeaderboards.get(roomId);
      const topGifters = roomLb
        ? Array.from(roomLb.values())
            .sort((a, b) => b.totalCoins - a.totalCoins)
            .slice(0, 10)
        : [];

      // Send initial room state to newly joined client
      client.emit('voiceRoomState', {
        room,
        seats: room.seats,
        topGifters,
      });

      // Entry effect & System message
      const fullUser = await this.usersService.findById(user.userId);
      if (fullUser?.activeEntryEffect) {
        client.to(roomChannel).emit('userEntryEffect', {
          user: {
            _id: user.userId,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
            currentLevel: fullUser.currentLevel || 1,
            levelBadgeUrl: fullUser.levelBadgeUrl || null,
          },
          entryEffectId: fullUser.activeEntryEffect,
          timestamp: new Date().toISOString(),
        });
      }

      // System join announcement to other viewers
      client.to(roomChannel).emit('voiceRoomMessage', {
        _id: `sys-${Date.now()}-${client.id}`,
        sender: {
          ...user,
          currentLevel: fullUser?.currentLevel || 1,
          levelBadgeUrl: fullUser?.levelBadgeUrl || null,
        },
        text: `${user.displayName} joined the room`,
        type: 'system',
        createdAt: new Date().toISOString(),
      });

      return { status: 'joined', roomId };
    } catch (error) {
      this.logger.error(`Join voice room failed: ${error.message}`);
      client.emit('error', error.message);
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('leaveVoiceRoom')
  async handleLeaveVoiceRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody('roomId') roomId: string,
  ) {
    const roomChannel = `voice-${roomId}`;
    client.leave(roomChannel);
    if (client.data.currentVoiceRoom === roomId) {
      client.data.currentVoiceRoom = null;
    }

    // If leaving user is occupying a guest seat (index !== 0), vacate the seat immediately
    if (client.data?.user?.userId) {
      const vUserId = client.data.user.userId;
      this.voiceRoomsService.findById(roomId).then((vRoom) => {
        if (vRoom && vRoom.isLive) {
          const seat = vRoom.seats.find(
            (s) => s.userId && s.userId.toString() === vUserId,
          );
          if (seat && seat.index !== 0) {
            this.voiceRoomsService.leaveSeat(roomId, seat.index, vUserId);
          }
        }
      }).catch(() => {});
    }

    this.updateVoiceRoomViewerCount(roomId);
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('requestSeat')
  async handleRequestSeat(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; seatIndex?: number },
  ) {
    try {
      const user = client.data.user;
      const request = await this.voiceRoomsService.createSeatRequest(
        data.roomId,
        user.userId,
        data.seatIndex ?? -1,
      );

      // Find host and notify them directly
      const room = await this.voiceRoomsService.findById(data.roomId);
      const hostId =
        (room.host as any)?._id?.toString() || room.host?.toString();
      const hostSocketId = this.userSockets.get(hostId);
      if (hostSocketId) {
        this.server.to(hostSocketId).emit('seatRequestReceived', {
          request,
          user,
        });
      }

      return { status: 'requested', request };
    } catch (error) {
      this.logger.error(`Request seat failed: ${error.message}`);
      client.emit('error', error.message);
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('cancelSeatRequest')
  async handleCancelSeatRequest(
    @ConnectedSocket() client: Socket,
    @MessageBody('roomId') roomId: string,
  ) {
    try {
      const user = client.data.user;
      await this.voiceRoomsService.cancelSeatRequest(roomId, user.userId);

      const room = await this.voiceRoomsService.findById(roomId);
      const hostId =
        (room.host as any)?._id?.toString() || room.host?.toString();
      const hostSocketId = this.userSockets.get(hostId);
      if (hostSocketId) {
        this.server.to(hostSocketId).emit('seatRequestCancelled', {
          roomId,
          userId: user.userId,
        });
      }

      return { status: 'cancelled' };
    } catch (error) {
      client.emit('error', error.message);
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('acceptSeatRequest')
  async handleAcceptSeatRequest(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      roomId: string;
      requestId: string;
      targetUserId: string;
      seatIndex: number;
    },
  ) {
    try {
      const hostUser = client.data.user;
      const room = await this.voiceRoomsService.findById(data.roomId);
      const hostId =
        (room.host as any)?._id?.toString() || room.host?.toString();
      if (hostId !== hostUser.userId) {
        throw new WsException('Only host can accept seat requests');
      }

      const targetUser = await this.usersService.findById(data.targetUserId);
      if (!targetUser) throw new WsException('Target user not found');

      const updatedSeats = await this.voiceRoomsService.takeSeat(
        data.roomId,
        data.seatIndex,
        {
          userId: targetUser._id.toString(),
          displayName: targetUser.displayName || targetUser.username,
          username: targetUser.username,
          avatarUrl: targetUser.avatarUrl || undefined,
        },
      );

      await this.voiceRoomsService.respondToSeatRequest(
        data.requestId,
        'accepted',
      );

      // Notify target user
      const targetSocketId = this.userSockets.get(data.targetUserId);
      if (targetSocketId) {
        this.server.to(targetSocketId).emit('seatRequestAccepted', {
          roomId: data.roomId,
          seatIndex: data.seatIndex,
        });
      }

      return { status: 'accepted', seats: updatedSeats };
    } catch (error) {
      this.logger.error(`Accept seat request failed: ${error.message}`);
      client.emit('error', error.message);
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('rejectSeatRequest')
  async handleRejectSeatRequest(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { roomId: string; requestId: string; targetUserId: string },
  ) {
    try {
      const hostUser = client.data.user;
      const room = await this.voiceRoomsService.findById(data.roomId);
      const hostId =
        (room.host as any)?._id?.toString() || room.host?.toString();
      if (hostId !== hostUser.userId) {
        throw new WsException('Only host can reject seat requests');
      }

      await this.voiceRoomsService.respondToSeatRequest(
        data.requestId,
        'rejected',
      );

      const targetSocketId = this.userSockets.get(data.targetUserId);
      if (targetSocketId) {
        this.server.to(targetSocketId).emit('seatRequestRejected', {
          roomId: data.roomId,
        });
      }

      return { status: 'rejected' };
    } catch (error) {
      client.emit('error', error.message);
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('inviteToSeat')
  async handleInviteToSeat(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { roomId: string; targetUserId: string; seatIndex: number },
  ) {
    try {
      const hostUser = client.data.user;
      const room = await this.voiceRoomsService.findById(data.roomId);
      const hostId =
        (room.host as any)?._id?.toString() || room.host?.toString();
      if (hostId !== hostUser.userId) {
        throw new WsException('Only host can invite to seats');
      }

      const targetSocketId = this.userSockets.get(data.targetUserId);
      if (targetSocketId) {
        this.server.to(targetSocketId).emit('seatInviteReceived', {
          roomId: data.roomId,
          seatIndex: data.seatIndex,
          roomTitle: room.title,
          host: hostUser,
        });
      }

      return { status: 'invited' };
    } catch (error) {
      client.emit('error', error.message);
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('acceptSeatInvite')
  async handleAcceptSeatInvite(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; seatIndex: number },
  ) {
    try {
      const user = client.data.user;
      const updatedSeats = await this.voiceRoomsService.takeSeat(
        data.roomId,
        data.seatIndex,
        user,
      );
      return { status: 'accepted', seats: updatedSeats };
    } catch (error) {
      client.emit('error', error.message);
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('rejectSeatInvite')
  async handleRejectSeatInvite(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; seatIndex: number },
  ) {
    try {
      const user = client.data.user;
      const room = await this.voiceRoomsService.findById(data.roomId);
      const hostId =
        (room.host as any)?._id?.toString() || room.host?.toString();
      const hostSocketId = this.userSockets.get(hostId);
      if (hostSocketId) {
        this.server.to(hostSocketId).emit('seatInviteRejected', {
          roomId: data.roomId,
          seatIndex: data.seatIndex,
          user,
        });
      }
      return { status: 'rejected' };
    } catch (error) {
      client.emit('error', error.message);
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('getVoiceRoomViewers')
  async handleGetVoiceRoomViewers(
    @ConnectedSocket() client: Socket,
    @MessageBody('roomId') roomId: string,
  ) {
    try {
      const roomChannel = `voice-${roomId}`;
      const socketIds = this.server.sockets.adapter.rooms.get(roomChannel);
      const viewers: any[] = [];
      if (socketIds) {
        for (const socketId of socketIds) {
          const s = this.server.sockets.sockets.get(socketId);
          if (s?.data?.user) {
            viewers.push(s.data.user);
          }
        }
      }
      return { status: 'success', viewers };
    } catch (error) {
      return { status: 'error', viewers: [] };
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('leaveSeat')
  async handleLeaveSeat(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; seatIndex: number },
  ) {
    try {
      const user = client.data.user;
      const updatedSeats = await this.voiceRoomsService.leaveSeat(
        data.roomId,
        data.seatIndex,
        user.userId,
      );
      return { status: 'left', seats: updatedSeats };
    } catch (error) {
      client.emit('error', error.message);
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('muteSeat')
  async handleMuteSeat(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { roomId: string; seatIndex: number; isMuted: boolean },
  ) {
    try {
      const hostUser = client.data.user;
      const room = await this.voiceRoomsService.findById(data.roomId);
      const hostId =
        (room.host as any)?._id?.toString() || room.host?.toString();
      if (hostId !== hostUser.userId) {
        throw new WsException('Only host can mute seats');
      }

      const updatedSeats = await this.voiceRoomsService.muteSeat(
        data.roomId,
        data.seatIndex,
        data.isMuted,
      );

      const seat = room.seats.find((s) => s.index === data.seatIndex);
      if (seat?.userId) {
        const targetSocketId = this.userSockets.get(seat.userId.toString());
        if (targetSocketId) {
          this.server.to(targetSocketId).emit('seatMuteChanged', {
            seatIndex: data.seatIndex,
            isMuted: data.isMuted,
          });
        }
      }

      return { status: 'success', seats: updatedSeats };
    } catch (error) {
      client.emit('error', error.message);
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('lockSeat')
  async handleLockSeat(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { roomId: string; seatIndex: number; isLocked: boolean },
  ) {
    try {
      const hostUser = client.data.user;
      const room = await this.voiceRoomsService.findById(data.roomId);
      const hostId =
        (room.host as any)?._id?.toString() || room.host?.toString();
      if (hostId !== hostUser.userId) {
        throw new WsException('Only host can lock seats');
      }

      const updatedSeats = await this.voiceRoomsService.lockSeat(
        data.roomId,
        data.seatIndex,
        data.isLocked,
      );
      this.server.to(`voice-${data.roomId}`).emit('seatsUpdated', {
        roomId: data.roomId,
        seats: updatedSeats,
      });
      return { status: 'success', seats: updatedSeats };
    } catch (error) {
      client.emit('error', error.message);
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('kickSeat')
  async handleKickSeat(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; seatIndex: number },
  ) {
    try {
      const hostUser = client.data.user;
      const room = await this.voiceRoomsService.findById(data.roomId);
      const hostId =
        (room.host as any)?._id?.toString() || room.host?.toString();
      if (hostId !== hostUser.userId) {
        throw new WsException('Only host can kick from seats');
      }

      const { seats, kickedUserId } = await this.voiceRoomsService.kickSeat(
        data.roomId,
        data.seatIndex,
      );

      if (kickedUserId) {
        const targetSocketId = this.userSockets.get(kickedUserId);
        if (targetSocketId) {
          this.server.to(targetSocketId).emit('seatKicked', {
            roomId: data.roomId,
            seatIndex: data.seatIndex,
          });
        }
      }

      return { status: 'kicked', seats };
    } catch (error) {
      client.emit('error', error.message);
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('sendVoiceRoomGift')
  async handleSendVoiceRoomGift(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      roomId: string;
      gift: {
        id: string;
        name: string;
        price: number;
        icon: string;
        animationUrl?: string;
      };
      targetSeatIndex: number;
    },
  ) {
    try {
      const user = client.data.user;

      // 1. Identify recipient
      const room = await this.voiceRoomsService.findById(data.roomId);
      let recipientId: string;
      let recipientName = 'Host';
      let recipientAvatar: string | null = null;

      const targetSeat = room.seats.find(
        (s) => s.index === data.targetSeatIndex,
      );
      if (targetSeat && targetSeat.userId) {
        recipientId = targetSeat.userId.toString();
        recipientName = targetSeat.displayName || targetSeat.username || 'User';
        recipientAvatar = targetSeat.avatarUrl;
      } else {
        recipientId =
          (room.host as any)?._id?.toString() || room.host?.toString();
        const hostUser = await this.usersService.findById(recipientId);
        recipientName = hostUser?.displayName || hostUser?.username || 'Host';
        recipientAvatar = hostUser?.avatarUrl || null;
      }

      // Prevent users from sending gifts to themselves
      if (recipientId === user.userId) {
        client.emit('error', 'You cannot send gifts to yourself');
        return { status: 'error', message: 'You cannot send gifts to yourself' };
      }

      // 2. Deduct coins from sender
      const hasEnoughCoins = await this.usersService.deductCoins(
        user.userId,
        data.gift.price,
      );
      if (!hasEnoughCoins) {
        client.emit('error', 'Insufficient coins to send this gift');
        return { status: 'error', message: 'Insufficient coins' };
      }

      // 3. Add coins and diamonds to recipient
      await this.usersService.addCoins(recipientId, data.gift.price);
      await this.usersService.addDiamonds(recipientId, data.gift.price);

      // 4. Grant XP to recipient (3 XP per coin) & sender (1 XP per coin)
      try {
        const hostXPResult = await this.levelsService.processXPGain(
          recipientId,
          data.gift.price * 3,
          'receive_gift',
        );
        if (hostXPResult?.leveledUp && hostXPResult.newLevel) {
          const recipientSocketId = this.userSockets.get(recipientId);
          if (recipientSocketId) {
            this.server.to(recipientSocketId).emit('levelUp', {
              userId: recipientId,
              newLevel: hostXPResult.newLevel,
              rewards: hostXPResult.rewards,
            });
          }
          this.server.to(`voice-${data.roomId}`).emit('userLevelUp', {
            user: {
              _id: recipientId,
              level: hostXPResult.newLevel.level,
              badgeUrl: hostXPResult.newLevel.badgeUrl,
            },
            newLevel: hostXPResult.newLevel,
          });
        }
      } catch (xpErr) {
        this.logger.warn(`Voice room recipient XP error: ${xpErr.message}`);
      }

      try {
        const senderXPResult = await this.levelsService.processXPGain(
          user.userId,
          data.gift.price * 1,
          'send_gift',
        );
        if (senderXPResult?.leveledUp && senderXPResult.newLevel) {
          client.emit('levelUp', {
            userId: user.userId,
            newLevel: senderXPResult.newLevel,
            rewards: senderXPResult.rewards,
          });
          this.server.to(`voice-${data.roomId}`).emit('userLevelUp', {
            user: {
              ...user,
              level: senderXPResult.newLevel.level,
              badgeUrl: senderXPResult.newLevel.badgeUrl,
            },
            newLevel: senderXPResult.newLevel,
          });
        }
      } catch (xpErr) {
        this.logger.warn(`Voice room sender XP error: ${xpErr.message}`);
      }

      // 5. Create Transactions
      await Promise.all([
        this.transactionsService.create({
          user: user.userId,
          amount: -data.gift.price,
          type: 'gift_sent',
          referenceId: data.roomId,
          description: `Sent gift ${data.gift.name} in voice room`,
          status: 'completed',
        }),
        this.transactionsService.create({
          user: recipientId,
          amount: data.gift.price,
          type: 'gift_received',
          referenceId: data.roomId,
          description: `Received gift ${data.gift.name} in voice room`,
          status: 'completed',
        }),
      ]);

      // 6. Update room total gifts received
      await this.voiceRoomsService.addGiftsTotal(data.roomId, data.gift.price);

      // 7. Update session in-memory leaderboard
      let roomLb = this.voiceRoomLeaderboards.get(data.roomId);
      if (!roomLb) {
        roomLb = new Map();
        this.voiceRoomLeaderboards.set(data.roomId, roomLb);
      }
      const prev = roomLb.get(user.userId) || {
        user: { ...user },
        totalCoins: 0,
      };
      prev.totalCoins += data.gift.price;
      roomLb.set(user.userId, prev);

      const topGifters = Array.from(roomLb.values())
        .sort((a, b) => b.totalCoins - a.totalCoins)
        .slice(0, 10);

      // 8. Emit gift event to all participants in voice room
      this.server.to(`voice-${data.roomId}`).emit('voiceRoomGiftReceived', {
        sender: user,
        recipient: {
          _id: recipientId,
          displayName: recipientName,
          avatarUrl: recipientAvatar,
        },
        gift: data.gift,
        seatIndex: data.targetSeatIndex,
        topGifters,
        timestamp: new Date().toISOString(),
      });

      // 9. Send gift chat message
      this.server.to(`voice-${data.roomId}`).emit('voiceRoomMessage', {
        _id: `gift-${Date.now()}-${client.id}`,
        sender: user,
        text: `Sent ${data.gift.name} ${data.gift.icon} to ${recipientName}`,
        type: 'gift',
        gift: data.gift,
        recipientName,
        createdAt: new Date().toISOString(),
      });

      return { status: 'sent' };
    } catch (error) {
      this.logger.error(`Send voice room gift failed: ${error.message}`);
      client.emit('error', error.message);
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('sendVoiceRoomMessage')
  async handleSendVoiceRoomMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; text: string },
  ) {
    try {
      const now = Date.now();
      const lastMsgTime = this.rateLimits.get(client.id) || 0;
      if (now - lastMsgTime < 1000) {
        throw new WsException('You are sending messages too fast.');
      }
      this.rateLimits.set(client.id, now);

      const user = client.data.user;
      const fullUser = await this.usersService.findById(user.userId);

      const message = {
        _id: `msg-${Date.now()}-${client.id}`,
        sender: {
          ...user,
          currentLevel: fullUser?.currentLevel || 1,
          levelBadgeUrl: fullUser?.levelBadgeUrl || null,
        },
        text: data.text,
        type: 'text',
        createdAt: new Date().toISOString(),
      };

      this.server.to(`voice-${data.roomId}`).emit('voiceRoomMessage', message);
      return { status: 'sent' };
    } catch (error) {
      this.logger.error(`Send voice room message failed: ${error.message}`);
      client.emit('error', error.message);
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('endVoiceRoom')
  async handleEndVoiceRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody('roomId') roomId: string,
  ) {
    try {
      const user = client.data.user;
      await this.voiceRoomsService.endRoom(roomId, user.userId, 'host_ended');
      return { status: 'ended' };
    } catch (error) {
      client.emit('error', error.message);
    }
  }

  private updateVoiceRoomViewerCount(roomId: string) {
    const room = this.server.sockets.adapter.rooms.get(`voice-${roomId}`);
    const viewerCount = room ? room.size : 0;
    this.server
      .to(`voice-${roomId}`)
      .emit('voiceRoomViewerCount', viewerCount);
    this.voiceRoomsService.updateViewerCount(roomId, viewerCount).catch(() => {});
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


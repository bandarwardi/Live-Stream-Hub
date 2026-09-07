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
import { GiftsService } from '../gifts/gifts.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/schemas/notification.schema';
import { Types } from 'mongoose';

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
    private readonly giftsService: GiftsService,
    private readonly notificationsService: NotificationsService,
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

    // PK Battle Global Callback: emits pkEnded to both broadcast rooms
    this.broadcastsService.onPkEnded = (endResult) => {
      if (endResult) {
        this.server?.to(endResult.broadcastIdA).emit('pkEnded', endResult);
        this.server?.to(endResult.broadcastIdB).emit('pkEnded', endResult);
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

    // Realtime Notifications Callback Hooks
    this.notificationsService.onNotificationCreated = (notification) => {
      const recipientId =
        notification.recipient?._id?.toString() ||
        notification.recipient?.toString();
      if (recipientId) {
        // Emitting to the room 'user-${recipientId}' ensures delivery to all of the user's active devices without duplicates
        this.server?.to(`user-${recipientId}`).emit('newNotification', notification);
      }
    };

    this.notificationsService.onAdminBroadcast = (broadcast) => {
      this.server?.emit('adminBroadcast', broadcast);
    };

    this.notificationsService.onAdminAlert = (alert) => {
      this.server?.to('admin_room').emit('newAdminAlert', alert);
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
      client.join(`user-${payload.sub}`);
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

  @SubscribeMessage('joinAdminRoom')
  handleJoinAdminRoom(@ConnectedSocket() client: Socket) {
    client.join('admin_room');
    return { status: 'joined_admin_room' };
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

      // SEC 1 Fix: Verify gift against database catalog - never trust client price
      const dbGift = await this.giftsService.findByIdOrName(gift.id || gift.name);
      if (!dbGift || !dbGift.isActive) {
        client.emit('error', 'Gift not found or no longer active');
        return { status: 'error', message: 'Gift not found' };
      }

      const verifiedPrice = dbGift.price;
      const verifiedGift = {
        id: dbGift._id.toString(),
        name: dbGift.name,
        price: verifiedPrice,
        icon: gift.icon || 'gift',
        imageUrl: dbGift.imageUrl,
        animationUrl: dbGift.animationUrl || gift.animationUrl,
      };

      // Validate broadcast and broadcaster first BEFORE deducting coins
      const broadcast = await this.broadcastsService.findById(broadcastId);
      if (!broadcast || !broadcast.isLive) {
        client.emit('error', 'Cannot send gift: Broadcast is not live');
        return { status: 'error', message: 'Broadcast not live' };
      }

      const broadcasterId =
        (broadcast.broadcaster as any)._id?.toString() ||
        broadcast.broadcaster?.toString();

      if (!broadcasterId) {
        client.emit('error', 'Broadcaster not found');
        return { status: 'error', message: 'Broadcaster not found' };
      }

      if (broadcasterId === user.userId) {
        client.emit('error', 'You cannot send gifts to yourself');
        return { status: 'error', message: 'Cannot send gift to self' };
      }

      // Deduct coins from sender
      const hasEnoughCoins = await this.usersService.deductCoins(
        user.userId,
        verifiedPrice,
      );
      if (!hasEnoughCoins) {
        client.emit('error', 'Insufficient coins to send this gift');
        return { status: 'error', message: 'Insufficient coins' };
      }

      // Add diamonds to broadcaster (diamonds are the platform earnings)
      try {
        await this.usersService.addDiamonds(broadcasterId, verifiedPrice);
      } catch (addErr) {
        // Rollback deducted coins
        await this.usersService.addCoins(user.userId, verifiedPrice);
        this.logger.error(`Failed to add diamonds to broadcaster, refunded sender: ${addErr.message}`);
        client.emit('error', 'Failed to process gift delivery. Coins have been refunded.');
        return { status: 'error', message: 'Gift processing failed' };
      }

      // Record transactions for sender and broadcaster
      try {
        await Promise.all([
          this.transactionsService.create({
            user: user.userId,
            amount: -verifiedPrice,
            type: 'gift_sent',
            referenceId: broadcastId,
            description: `Sent gift ${verifiedGift.name} in live stream`,
            status: 'completed',
          }),
          this.transactionsService.create({
            user: broadcasterId,
            amount: verifiedPrice,
            type: 'gift_received',
            referenceId: broadcastId,
            description: `Received gift ${verifiedGift.name} in live stream`,
            status: 'completed',
          }),
        ]);
      } catch (tErr) {
        this.logger.error(`CRITICAL: Failed to log live stream gift transactions: ${tErr.message}`);
      }

      // Grant XP to broadcaster (3 XP per coin received - Bigo Live style)
      try {
        const hostXPResult = await this.levelsService.processXPGain(
          broadcasterId,
          verifiedPrice * 3,
          'receive_gift',
        );
        if (hostXPResult?.leveledUp && hostXPResult.newLevel) {
          const hostSocketId = this.userSockets.get(broadcasterId);
          if (hostSocketId) {
            this.server.to(hostSocketId).emit('levelUp', {
              userId: broadcasterId,
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

          this.notificationsService
            .createAndSend({
              recipientId: broadcasterId,
              type: NotificationType.LEVEL_UP,
              title: 'ترقية المستوى! 🌟',
              message: `تهانينا! لقد وصلت إلى المستوى ${hostXPResult.newLevel.level}`,
              data: { level: hostXPResult.newLevel.level },
            })
            .catch((e) =>
              this.logger.error('Failed to send level up notification:', e),
            );
        }
      } catch (xpErr) {
        this.logger.warn(`Broadcaster XP gain failed: ${xpErr.message}`);
      }

      // Grant XP to sender (1 XP per coin spent)
      try {
        const senderXPResult = await this.levelsService.processXPGain(
          user.userId,
          verifiedPrice * 1,
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

          this.notificationsService
            .createAndSend({
              recipientId: user.userId,
              type: NotificationType.LEVEL_UP,
              title: 'ترقية المستوى! 🌟',
              message: `تهانينا! لقد وصلت إلى المستوى ${senderXPResult.newLevel.level}`,
              data: { level: senderXPResult.newLevel.level },
            })
            .catch((e) =>
              this.logger.error('Failed to send level up notification:', e),
            );
        }
      } catch (xpErr) {
        this.logger.warn(`Sender XP gain failed: ${xpErr.message}`);
      }

      // Emit gift event to everyone in the room (including the sender, so they see the animation)
      this.server.to(broadcastId).emit('giftReceived', {
        sender: user,
        gift: verifiedGift,
        timestamp: new Date().toISOString(),
      });

      // Dispatch in-app and push notification for gift to broadcaster
      this.notificationsService
        .createAndSend({
          recipientId: broadcasterId,
          senderId: user.userId,
          type: NotificationType.GIFT_RECEIVED,
          title: 'هدية جديدة 🎁',
          message: `أرسل لك ${user.displayName || user.username} هدية ${verifiedGift.name}`,
          data: {
            broadcastId,
            giftId: verifiedGift.id,
            coins: verifiedPrice,
          },
        })
        .catch((e) =>
          this.logger.error('Failed to create gift notification:', e),
        );

      // Update PK battle scores and top gifters atomically in DB if active
      const pkResult = await this.broadcastsService.recordPkGift(
        broadcastId,
        user,
        verifiedPrice,
      );
      if (pkResult) {
        this.server.to(pkResult.broadcastIdA).emit('pkTopGiftersUpdated', pkResult.topGifters);
        this.server.to(pkResult.broadcastIdB).emit('pkTopGiftersUpdated', pkResult.topGifters);

        const scorePayload = {
          scores: pkResult.scores,
          addedScore: verifiedPrice,
          side: pkResult.side,
          sender: user,
        };
        this.server.to(pkResult.broadcastIdA).emit('pkScoreUpdated', scorePayload);
        this.server.to(pkResult.broadcastIdB).emit('pkScoreUpdated', scorePayload);
      }

      // Optionally send a system message to chat
      const giftMessage = {
        _id: `gift-${Date.now()}-${client.id}`,
        sender: user,
        text: `Sent a ${verifiedGift.name} ${verifiedGift.icon}`,
        type: 'gift',
        gift: verifiedGift,
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

  // ==========================================
  //            PK BATTLE EVENTS
  // ==========================================

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('pkInvite')
  async handlePkInvite(
    @ConnectedSocket() client: Socket,
    @MessageBody('broadcastId') broadcastId: string,
    @MessageBody('opponentBroadcastId') opponentBroadcastId: string,
  ) {
    try {
      const user = client.data.user;
      if (!Types.ObjectId.isValid(broadcastId) || !Types.ObjectId.isValid(opponentBroadcastId)) {
        throw new WsException('Invalid broadcast ID');
      }

      const result = await this.broadcastsService.invitePk(
        broadcastId,
        opponentBroadcastId,
        user.userId,
      );

      const invitePayload = {
        fromBroadcast: result.broadcastA,
        toBroadcast: result.broadcastB,
        fromUser: result.broadcastA.broadcaster,
        toUser: result.broadcastB.broadcaster,
        durationSeconds: 600,
        expiresAt: result.broadcastB.pk.inviteExpiresAt,
      };

      // Emit to opponent's broadcast room so viewers/host see invite
      this.server.to(opponentBroadcastId).emit('pkInviteReceived', invitePayload);

      // Also directly emit to opponent broadcaster socket if connected
      const opponentBroadcasterId =
        (result.broadcastB.broadcaster as any)?._id?.toString() ||
        result.broadcastB.broadcaster?.toString();
      if (opponentBroadcasterId) {
        const socketId = this.userSockets.get(opponentBroadcasterId);
        if (socketId) {
          this.server.to(socketId).emit('pkInviteReceived', invitePayload);
        }

        // Dispatch PK Invite notification
        this.notificationsService
          .createAndSend({
            recipientId: opponentBroadcasterId,
            senderId: user.userId,
            type: NotificationType.PK_INVITE,
            title: 'دعوة تحدي PK ⚔️',
            message: `دعاك ${user.displayName || user.username} لخوض تحدي PK مباشر!`,
            data: {
              fromBroadcastId: broadcastId,
              toBroadcastId: opponentBroadcastId,
            },
          })
          .catch((e) =>
            this.logger.error('Failed to create PK notification:', e),
          );
      }

      return { status: 'invited' };
    } catch (err) {
      this.logger.error(`pkInvite error: ${err.message}`);
      client.emit('error', err.message);
      return { status: 'error', message: err.message };
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('pkAccept')
  async handlePkAccept(
    @ConnectedSocket() client: Socket,
    @MessageBody('broadcastId') broadcastId: string,
  ) {
    try {
      const user = client.data.user;
      if (!Types.ObjectId.isValid(broadcastId)) {
        throw new WsException('Invalid broadcast ID');
      }

      const result = await this.broadcastsService.acceptPk(
        broadcastId,
        user.userId,
      );

      const broadcastIdA = result.broadcastA._id.toString();
      const broadcastIdB = result.broadcastB._id.toString();

      const pkStartedPayload = {
        broadcastA: result.broadcastA,
        broadcastB: result.broadcastB,
        hostA: result.broadcastA.broadcaster,
        hostB: result.broadcastB.broadcaster,
        startedAt: result.startedAt,
        endsAt: result.endsAt,
        durationSeconds: result.durationSeconds,
        scores: { hostA: 0, hostB: 0 },
      };

      // Emit to both broadcast rooms
      this.server.to(broadcastIdA).emit('pkStarted', pkStartedPayload);
      this.server.to(broadcastIdB).emit('pkStarted', pkStartedPayload);

      return { status: 'started' };
    } catch (err) {
      this.logger.error(`pkAccept error: ${err.message}`);
      client.emit('error', err.message);
      return { status: 'error', message: err.message };
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('pkDecline')
  async handlePkDecline(
    @ConnectedSocket() client: Socket,
    @MessageBody('broadcastId') broadcastId: string,
  ) {
    try {
      const user = client.data.user;
      if (!Types.ObjectId.isValid(broadcastId)) {
        throw new WsException('Invalid broadcast ID');
      }

      const res = await this.broadcastsService.declinePk(
        broadcastId,
        user.userId,
      );
      if (res?.opponentBroadcastId) {
        this.server.to(res.opponentBroadcastId).emit('pkDeclined', { broadcastId });
      }
      if (res?.opponentBroadcasterId) {
        const socketId = this.userSockets.get(res.opponentBroadcasterId);
        if (socketId) {
          this.server.to(socketId).emit('pkDeclined', { broadcastId });
        }
      }
      return { status: 'declined' };
    } catch (err) {
      this.logger.error(`pkDecline error: ${err.message}`);
      return { status: 'error', message: err.message };
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('pkEndEarly')
  async handlePkEndEarly(
    @ConnectedSocket() client: Socket,
    @MessageBody('broadcastId') broadcastId: string,
  ) {
    try {
      const user = client.data.user;
      if (!Types.ObjectId.isValid(broadcastId)) {
        throw new WsException('Invalid broadcast ID');
      }

      const broadcast = await this.broadcastsService.findById(broadcastId);
      if (!broadcast || broadcast.pk?.status !== 'active') {
        return { status: 'no_active_pk' };
      }

      const broadcasterId =
        (broadcast.broadcaster as any)?._id?.toString() ||
        broadcast.broadcaster?.toString();
      const opponentBroadcasterId = broadcast.pk.opponentUserId?.toString();

      // Auth check: Verify requester is one of the participating broadcasters
      if (user.userId !== broadcasterId && user.userId !== opponentBroadcasterId) {
        throw new WsException('Only participating broadcasters can end the PK battle');
      }

      const opponentBroadcastId = broadcast.pk.opponentBroadcastId?.toString();
      if (!opponentBroadcastId || !Types.ObjectId.isValid(opponentBroadcastId)) {
        return { status: 'invalid_opponent' };
      }

      const broadcastIdA =
        broadcast.pk.pkRole === 'hostA' ? broadcastId : opponentBroadcastId;
      const broadcastIdB =
        broadcast.pk.pkRole === 'hostA' ? opponentBroadcastId : broadcastId;

      await this.broadcastsService.endPk(
        broadcastIdA,
        broadcastIdB,
        'early_end',
      );

      return { status: 'ended' };
    } catch (err) {
      this.logger.error(`pkEndEarly error: ${err.message}`);
      return { status: 'error', message: err.message };
    }
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

      if (!payload.conversationId || !Types.ObjectId.isValid(payload.conversationId)) {
        client.emit('error', 'Invalid conversation ID');
        return { status: 'error', message: 'Invalid conversation ID' };
      }

      // Pre-validate conversation and participant
      const conversation = await (
        this.conversationsService as any
      ).conversationModel.findById(payload.conversationId);
      if (!conversation) {
        client.emit('error', 'Conversation not found');
        return { status: 'error', message: 'Conversation not found' };
      }

      const isParticipant = conversation.participants.some(
        (p) => p.toString() === user.userId,
      );
      if (!isParticipant) {
        client.emit('error', 'You are not a participant of this conversation');
        return { status: 'error', message: 'Not a participant' };
      }

      const recipientId = conversation.participants
        .find((p) => p.toString() !== user.userId)
        ?.toString();

      let verifiedGiftCost = 0;
      let verifiedGiftName = 'Gift';

      // Handle gift deduction with database catalog validation
      if (payload.type === 'gift' && payload.giftData) {
        if (!recipientId) {
          client.emit('error', 'Cannot send gift: Recipient not found');
          return { status: 'error', message: 'Recipient not found' };
        }

        const giftIdentifier =
          payload.giftData.id || payload.giftData._id || payload.giftData.name;
        const dbGift = await this.giftsService.findByIdOrName(giftIdentifier);
        if (!dbGift || !dbGift.isActive) {
          client.emit('error', 'Gift not found or no longer active');
          return { status: 'error', message: 'Gift not found' };
        }

        const giftCount = Math.max(Number(payload.giftData.count) || 1, 1);
        verifiedGiftCost = dbGift.price * giftCount;
        verifiedGiftName = dbGift.name;

        payload.giftData = {
          ...payload.giftData,
          id: dbGift._id.toString(),
          name: dbGift.name,
          price: dbGift.price,
          count: giftCount,
          totalPrice: verifiedGiftCost,
          imageUrl: dbGift.imageUrl,
          animationUrl: dbGift.animationUrl,
        };

        const hasEnoughCoins = await this.usersService.deductCoins(
          user.userId,
          verifiedGiftCost,
        );
        if (!hasEnoughCoins) {
          client.emit('error', 'Insufficient coins to send this gift');
          return { status: 'error', message: 'Insufficient coins' };
        }
      }

      // Save message with rollback protection
      let savedMessage;
      try {
        savedMessage = await this.conversationsService.saveMessage({
          conversationId: payload.conversationId,
          senderId: user.userId,
          type: payload.type,
          text: payload.text,
          mediaUrl: payload.mediaUrl,
          giftData: payload.giftData,
        });
      } catch (saveErr) {
        if (payload.type === 'gift' && verifiedGiftCost > 0) {
          await this.usersService.addCoins(user.userId, verifiedGiftCost);
        }
        throw saveErr;
      }

      // Add diamonds & record transactions if gift
      if (payload.type === 'gift' && recipientId && verifiedGiftCost > 0) {
        try {
          await this.usersService.addDiamonds(recipientId, verifiedGiftCost);
          await this.usersService.addXP(user.userId, verifiedGiftCost);
        } catch (rewardErr) {
          this.logger.warn(`Failed to credit recipient diamonds/XP: ${rewardErr.message}`);
        }

        // Record transactions for DM gifts
        try {
          await Promise.all([
            this.transactionsService.create({
              user: user.userId,
              amount: -verifiedGiftCost,
              type: 'gift_sent',
              referenceId: payload.conversationId,
              description: `Sent gift ${verifiedGiftName} in chat`,
              status: 'completed',
            }),
            this.transactionsService.create({
              user: recipientId,
              amount: verifiedGiftCost,
              type: 'gift_received',
              referenceId: payload.conversationId,
              description: `Received gift ${verifiedGiftName} in chat`,
              status: 'completed',
            }),
          ]);
        } catch (tErr) {
          this.logger.error(`Failed to log DM gift transactions: ${tErr.message}`);
        }
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

      // 1. Validate room
      const room = await this.voiceRoomsService.findById(data.roomId);
      if (!room || !room.isLive) {
        client.emit('error', 'Voice room is not active');
        return { status: 'error', message: 'Voice room not active' };
      }

      // 2. Validate gift from database catalog - never trust client price
      const giftIdOrName = data.gift?.id || data.gift?.name;
      const dbGift = await this.giftsService.findByIdOrName(giftIdOrName);
      if (!dbGift || !dbGift.isActive) {
        client.emit('error', 'Gift not found or no longer active');
        return { status: 'error', message: 'Gift not found' };
      }

      const verifiedPrice = dbGift.price;
      const verifiedGift = {
        id: dbGift._id.toString(),
        name: dbGift.name,
        price: verifiedPrice,
        icon: data.gift?.icon || 'gift',
        imageUrl: dbGift.imageUrl,
        animationUrl: dbGift.animationUrl || data.gift?.animationUrl,
      };

      // 3. Identify recipient
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

      // 4. Deduct coins from sender
      const hasEnoughCoins = await this.usersService.deductCoins(
        user.userId,
        verifiedPrice,
      );
      if (!hasEnoughCoins) {
        client.emit('error', 'Insufficient coins to send this gift');
        return { status: 'error', message: 'Insufficient coins' };
      }

      // 5. Add diamonds to recipient (gift earnings) with rollback on failure
      try {
        await this.usersService.addDiamonds(recipientId, verifiedPrice);
      } catch (diamondErr) {
        await this.usersService.addCoins(user.userId, verifiedPrice);
        this.logger.error(`Failed to credit diamonds in voice room, refunded sender: ${diamondErr.message}`);
        client.emit('error', 'Failed to process voice room gift. Coins refunded.');
        return { status: 'error', message: 'Gift processing failed' };
      }

      // 6. Grant XP to recipient (3 XP per coin) & sender (1 XP per coin)
      try {
        const hostXPResult = await this.levelsService.processXPGain(
          recipientId,
          verifiedPrice * 3,
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
          verifiedPrice * 1,
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

      // 7. Create Transactions
      try {
        await Promise.all([
          this.transactionsService.create({
            user: user.userId,
            amount: -verifiedPrice,
            type: 'gift_sent',
            referenceId: data.roomId,
            description: `Sent gift ${verifiedGift.name} in voice room`,
            status: 'completed',
          }),
          this.transactionsService.create({
            user: recipientId,
            amount: verifiedPrice,
            type: 'gift_received',
            referenceId: data.roomId,
            description: `Received gift ${verifiedGift.name} in voice room`,
            status: 'completed',
          }),
        ]);
      } catch (tErr) {
        this.logger.error(`Failed to log voice room gift transactions: ${tErr.message}`);
      }

      // 8. Update room total gifts received
      await this.voiceRoomsService.addGiftsTotal(data.roomId, verifiedPrice);

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
      prev.totalCoins += verifiedPrice;
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
        gift: verifiedGift,
        seatIndex: data.targetSeatIndex,
        topGifters,
        timestamp: new Date().toISOString(),
      });

      // 9. Send gift chat message
      this.server.to(`voice-${data.roomId}`).emit('voiceRoomMessage', {
        _id: `gift-${Date.now()}-${client.id}`,
        sender: user,
        text: `Sent ${verifiedGift.name} ${verifiedGift.icon} to ${recipientName}`,
        type: 'gift',
        gift: verifiedGift,
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


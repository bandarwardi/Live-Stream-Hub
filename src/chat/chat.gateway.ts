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
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';

@WebSocketGateway({ cors: { origin: '*' } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);

  // Keep track of rate limits: socketId -> lastMessageTimestamp
  private rateLimits = new Map<string, number>();

  constructor(
    private readonly chatService: ChatService,
    private readonly broadcastsService: BroadcastsService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      // Manual verification on connection to drop unauthorized sockets immediately
      const authHeader = client.handshake.auth?.token || client.handshake.headers?.authorization;
      if (!authHeader) {
        client.disconnect();
        return;
      }
      const token = authHeader.split(' ').length === 2 ? authHeader.split(' ')[1] : authHeader;
      const secret = this.configService.get<string>('JWT_ACCESS_SECRET');
      const payload = this.jwtService.verify(token, { secret });
      const user = await this.usersService.findById(payload.sub);
      if (!user) {
        client.disconnect();
        return;
      }
      client.data.user = { userId: payload.sub, username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl };
      this.logger.log(`Client connected: ${client.id} (${user.username})`);
    } catch (error) {
      this.logger.error(`Connection failed for client ${client.id}: ${error.message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    this.rateLimits.delete(client.id);
    
    // When a client disconnects, socket.io automatically removes them from all rooms.
    // But we need to update the viewer count for the rooms they were in.
    // socket.rooms only contains the socket id itself on disconnect, so we can't easily get the rooms here.
    // In a real app, we'd track which user is in which room manually to decrement counts, 
    // but we can also just rely on periodic syncs or let the client explicitly leave.
    // For simplicity, we'll let `leaveRoom` handle explicit leaves, and socket.io handles disconnect cleans.
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

      // Send recent messages to the newly joined client
      const recentMessages = await this.chatService.getRecentMessages(broadcastId);
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
        throw new WsException('You are sending messages too fast. Please wait.');
      }
      this.rateLimits.set(client.id, now);

      // 2. Validate Room & Broadcast Status
      const broadcast = await this.broadcastsService.findById(broadcastId);
      if (!broadcast || !broadcast.isLive) {
        throw new WsException('Cannot send message: Broadcast is ended or not found');
      }

      // 3. Save Message
      const user = client.data.user;
      const savedMessage = await this.chatService.saveMessage(broadcastId, user.userId, text);

      // 4. Broadcast to Room
      this.server.to(broadcastId).emit('newMessage', savedMessage);

      return { status: 'sent' };
    } catch (error) {
      this.logger.error(`Send message failed: ${error.message}`);
      client.emit('error', error.message);
    }
  }

  private updateViewerCount(broadcastId: string) {
    const room = this.server.sockets.adapter.rooms.get(broadcastId);
    const viewerCount = room ? room.size : 0;
    this.server.to(broadcastId).emit('viewerCount', viewerCount);
  }
}

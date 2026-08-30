import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Call } from './schemas/call.schema';
import { v4 as uuidv4 } from 'uuid';
import { BroadcastsService } from '../broadcasts/broadcasts.service'; // To reuse generateAgoraToken
import { ChatGateway } from '../chat/chat.gateway';
import { ConversationsService } from '../chat/conversations.service';

@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);

  constructor(
    @InjectModel(Call.name) private callModel: Model<Call>,
    private broadcastsService: BroadcastsService,
    private chatGateway: ChatGateway,
    private conversationsService: ConversationsService,
  ) {}

  async initiateCall(
    callerId: string,
    calleeId: string,
    type: 'voice' | 'video',
  ): Promise<Call> {
    if (!Types.ObjectId.isValid(callerId) || !Types.ObjectId.isValid(calleeId)) {
      throw new BadRequestException('Invalid caller or callee ID');
    }

    if (callerId === calleeId) {
      throw new ConflictException('You cannot call yourself');
    }

    // Check if either user is already in an active/ringing call
    const existingCalls = await this.callModel.find({
      $or: [
        { caller: callerId },
        { callee: callerId },
        { caller: calleeId },
        { callee: calleeId },
      ],
      status: { $in: ['ringing', 'active'] },
    });

    const now = Date.now();
    for (const ec of existingCalls) {
      // If a call has been ringing for more than 45s without answer, auto-end it
      if (ec.status === 'ringing' && now - new Date((ec as any).createdAt).getTime() > 45000) {
        ec.status = 'ended';
        ec.endedAt = new Date();
        await ec.save();
      }
    }

    const stillActive = existingCalls.some(
      (c) =>
        c.status === 'active' ||
        (c.status === 'ringing' && now - new Date((c as any).createdAt).getTime() <= 45000),
    );

    if (stillActive) {
      throw new ConflictException('User is already in a call');
    }

    const channelName = uuidv4();

    const call = new this.callModel({
      caller: callerId,
      callee: calleeId,
      type,
      status: 'ringing',
      channelName,
    });

    const savedCall = await call.save();
    await savedCall.populate('caller', 'username displayName avatarUrl');

    this.chatGateway.emitToUser(calleeId, 'incomingCall', savedCall);

    return savedCall;
  }

  async answerCall(callId: string, userId: string): Promise<Call> {
    if (!Types.ObjectId.isValid(callId)) {
      throw new BadRequestException('Invalid call ID');
    }

    const call = await this.callModel.findById(callId);
    if (!call) throw new NotFoundException('Call not found');

    if (call.callee.toString() !== userId) {
      throw new ForbiddenException('Only the callee can answer the call');
    }

    if (call.status !== 'ringing') {
      throw new ConflictException(
        `Cannot answer call in status: ${call.status}`,
      );
    }

    call.status = 'active';
    call.startedAt = new Date();
    const savedCall = await call.save();

    this.chatGateway.emitToUser(call.caller.toString(), 'callAnswered', {
      callId: call._id,
    });
    return savedCall;
  }

  async rejectCall(callId: string, userId: string): Promise<Call> {
    if (!Types.ObjectId.isValid(callId)) {
      throw new BadRequestException('Invalid call ID');
    }

    const call = await this.callModel.findById(callId);
    if (!call) throw new NotFoundException('Call not found');

    if (call.callee.toString() !== userId) {
      throw new ForbiddenException('Only the callee can reject the call');
    }

    if (call.status !== 'ringing') {
      throw new ConflictException(
        `Cannot reject call in status: ${call.status}`,
      );
    }

    call.status = 'rejected';
    call.endedAt = new Date();
    const savedCall = await call.save();

    this.chatGateway.emitToUser(call.caller.toString(), 'callRejected', {
      callId: call._id,
    });

    // Create system message
    try {
      const conv = await this.conversationsService.findOrCreateConversation(
        call.caller.toString(),
        call.callee.toString(),
      );
      if (conv) {
        const msg = await this.conversationsService.saveMessage({
          conversationId: conv._id.toString(),
          senderId: call.caller.toString(),
          type: 'call',
          text: `Missed ${call.type} call`,
        });
        // Emit to room
        this.chatGateway.server
          .to(`conv-${conv._id}`)
          .emit('newDirectMessage', msg);
      }
    } catch (e) {
      this.logger.error('Failed to create call rejected message: ' + e.message);
    }

    return savedCall;
  }

  async endCall(callId: string, userId: string): Promise<Call> {
    if (!Types.ObjectId.isValid(callId)) {
      throw new BadRequestException('Invalid call ID');
    }

    const call = await this.callModel.findById(callId);
    if (!call) throw new NotFoundException('Call not found');

    if (
      call.caller.toString() !== userId &&
      call.callee.toString() !== userId
    ) {
      throw new ForbiddenException('You are not part of this call');
    }

    if (call.status === 'ended') return call; // Already ended

    if (call.status === 'ringing') {
      call.status = call.caller.toString() === userId ? 'ended' : 'rejected';
    } else {
      call.status = 'ended';
    }

    call.endedAt = new Date();

    if (call.startedAt) {
      call.duration = Math.floor(
        (call.endedAt.getTime() - call.startedAt.getTime()) / 1000,
      );
    }

    const savedCall = await call.save();

    const otherUserId =
      call.caller.toString() === userId
        ? call.callee.toString()
        : call.caller.toString();
    this.chatGateway.emitToUser(otherUserId, 'callEnded', { callId: call._id });

    // Create system message
    try {
      const conv = await this.conversationsService.findOrCreateConversation(
        call.caller.toString(),
        call.callee.toString(),
      );
      if (conv) {
        const text =
          call.duration > 0
            ? `${call.type === 'video' ? 'Video' : 'Voice'} call ended (${Math.floor(call.duration / 60)}:${(call.duration % 60).toString().padStart(2, '0')})`
            : `Missed ${call.type} call`;

        const msg = await this.conversationsService.saveMessage({
          conversationId: conv._id.toString(),
          senderId: call.caller.toString(),
          type: 'call',
          text,
        });
        this.chatGateway.server
          .to(`conv-${conv._id}`)
          .emit('newDirectMessage', msg);
      }
    } catch (e) {
      this.logger.error('Failed to create call ended message: ' + e.message);
    }

    return savedCall;
  }

  async getCallToken(
    callId: string,
    userId: string,
  ): Promise<{ token: string; uid: number; channelName: string }> {
    if (!Types.ObjectId.isValid(callId)) {
      throw new BadRequestException('Invalid call ID');
    }

    const call = await this.callModel.findById(callId);
    if (!call) throw new NotFoundException('Call not found');

    if (
      call.caller.toString() !== userId &&
      call.callee.toString() !== userId
    ) {
      throw new ForbiddenException('You are not part of this call');
    }

    const uid = Math.floor(Math.random() * 100000) + 1;

    const token = this.broadcastsService.generateAgoraToken(
      call.channelName,
      uid,
      'publisher',
    );

    return { token, uid, channelName: call.channelName };
  }

  async getCallHistory(userId: string): Promise<Call[]> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user ID');
    }

    return this.callModel
      .find({
        $or: [{ caller: userId }, { callee: userId }],
      })
      .populate('caller', 'username displayName avatarUrl')
      .populate('callee', 'username displayName avatarUrl')
      .sort({ createdAt: -1 })
      .limit(50)
      .exec();
  }

  async getCallById(callId: string, userId: string): Promise<Call> {
    if (!Types.ObjectId.isValid(callId)) {
      throw new BadRequestException('Invalid call ID');
    }

    const call = await this.callModel
      .findById(callId)
      .populate('caller', 'username displayName avatarUrl')
      .populate('callee', 'username displayName avatarUrl')
      .exec();

    if (!call) throw new NotFoundException('Call not found');

    if (
      call.caller._id.toString() !== userId &&
      call.callee._id.toString() !== userId
    ) {
      throw new ForbiddenException('You are not part of this call');
    }

    return call;
  }
}

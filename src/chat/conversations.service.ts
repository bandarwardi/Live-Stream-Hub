import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Conversation } from './schemas/conversation.schema';
import { DirectMessage } from './schemas/direct-message.schema';

@Injectable()
export class ConversationsService {
  constructor(
    @InjectModel(Conversation.name)
    private conversationModel: Model<Conversation>,
    @InjectModel(DirectMessage.name) private messageModel: Model<DirectMessage>,
  ) {}

  async getConversations(userId: string) {
    const conversations = await this.conversationModel
      .find({ participants: userId })
      .sort({ updatedAt: -1 })
      .populate(
        'participants',
        'username displayName avatarUrl isOnline lastSeen',
      )
      .populate({
        path: 'lastMessage',
        select: 'text type mediaUrl giftData createdAt sender isRead',
      })
      .exec();

    // Calculate unread counts dynamically (optional)
    return conversations;
  }

  async getConversationById(id: string) {
    const conversation = await this.conversationModel
      .findById(id)
      .populate(
        'participants',
        'username displayName avatarUrl isOnline lastSeen',
      )
      .populate({
        path: 'lastMessage',
        select: 'text type mediaUrl giftData createdAt sender isRead',
      })
      .exec();

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    return conversation;
  }

  async findOrCreateConversation(user1Id: string, user2Id: string) {
    if (user1Id === user2Id) {
      throw new BadRequestException(
        'Cannot start a conversation with yourself',
      );
    }

    let conversation = await this.conversationModel.findOne({
      participants: { $all: [user1Id, user2Id] },
    });

    if (!conversation) {
      conversation = new this.conversationModel({
        participants: [user1Id, user2Id],
        unreadCounts: new Map([
          [user1Id, 0],
          [user2Id, 0],
        ]),
      });
      await conversation.save();
    }

    return this.conversationModel
      .findById(conversation._id)
      .populate('participants', 'username displayName avatarUrl isOnline')
      .exec();
  }

  async getMessages(
    conversationId: string,
    limit: number = 30,
    cursor?: string,
  ) {
    const query: any = { conversation: conversationId };

    if (cursor) {
      query._id = { $lt: cursor };
    }

    const messages = await this.messageModel
      .find(query)
      .sort({ _id: -1 }) // Newest first
      .limit(limit + 1)
      .populate('sender', 'username displayName avatarUrl')
      .exec();

    const hasMore = messages.length > limit;
    if (hasMore) {
      messages.pop();
    }

    return {
      data: messages.reverse(), // Send oldest first to front-end for chat rendering
      nextCursor: hasMore ? messages[0]._id.toString() : null, // Actually for inverted lists, _id of the oldest fetched
      hasMore,
    };
  }

  async saveMessage(data: {
    conversationId: string;
    senderId: string;
    type: string;
    text?: string;
    mediaUrl?: string;
    giftData?: any;
  }) {
    const conversation = await this.conversationModel.findById(
      data.conversationId,
    );
    if (!conversation) throw new NotFoundException('Conversation not found');
    const isParticipant = conversation.participants.some(
      (p) => p.toString() === data.senderId,
    );
    if (!isParticipant)
      throw new BadRequestException('User not part of conversation');

    const message = new this.messageModel({
      conversation: data.conversationId,
      sender: data.senderId,
      type: data.type,
      text: data.text || '',
      mediaUrl: data.mediaUrl || null,
      giftData: data.giftData || null,
    });

    const savedMessage = await message.save();

    // Increment unread counts for all OTHER participants
    const incUpdates: any = {};
    conversation.participants.forEach((p) => {
      const pid = p.toString();
      if (pid !== data.senderId) {
        incUpdates[`unreadCounts.${pid}`] = 1;
      }
    });

    await this.conversationModel.findByIdAndUpdate(data.conversationId, {
      lastMessage: savedMessage._id,
      updatedAt: new Date(),
      $inc: Object.keys(incUpdates).length > 0 ? incUpdates : undefined,
    });

    return this.messageModel
      .findById(savedMessage._id)
      .populate('sender', 'username displayName avatarUrl')
      .exec();
  }

  async markAsRead(conversationId: string, userId: string) {
    const updateKey = `unreadCounts.${userId}`;
    await this.conversationModel.findByIdAndUpdate(conversationId, {
      $set: { [updateKey]: 0 },
    });
  }
}

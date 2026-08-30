import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Message } from './schemas/message.schema';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectModel(Message.name) private messageModel: Model<Message>,
  ) {}

  async saveMessage(
    broadcastId: string,
    userId: string,
    text: string,
    type: string = 'message',
  ) {
    const sanitizedText = this.sanitizeText(text);

    const message = new this.messageModel({
      broadcast: broadcastId,
      sender: userId,
      text: sanitizedText,
      type,
    });

    await message.save();

    // Populate sender details before returning so the client has avatar/name
    return this.messageModel
      .findById(message._id)
      .populate('sender', 'username displayName avatarUrl')
      .exec();
  }

  async getRecentMessages(broadcastId: string, limit: number = 50) {
    return this.messageModel
      .find({ broadcast: broadcastId })
      .sort({ createdAt: -1 }) // Get newest first
      .limit(limit)
      .populate('sender', 'username displayName avatarUrl')
      .exec()
      .then((msgs) => msgs.reverse()); // Reverse to get oldest-to-newest for the chat UI
  }

  private sanitizeText(text: string): string {
    if (!text) return '';
    // Basic sanitization: prevent HTML tags.
    // In a real production app, use a robust library like DOMPurify or sanitize-html.
    return text.replace(/</g, '&lt;').replace(/>/g, '&gt;').trim();
  }
}

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

@Schema({ timestamps: true })
export class DirectMessage extends Document {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
  })
  conversation: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  sender: string;

  @Prop({ default: '' })
  text: string;

  @Prop({
    required: true,
    enum: ['text', 'image', 'video', 'audio', 'gift', 'call'],
    default: 'text',
  })
  type: string;

  @Prop({ default: null })
  mediaUrl: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  giftData: any; // { id, name, price, icon }

  @Prop({ default: false })
  isRead: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const DirectMessageSchema = SchemaFactory.createForClass(DirectMessage);

// Index to quickly fetch messages for a conversation
DirectMessageSchema.index({ conversation: 1, createdAt: 1 });

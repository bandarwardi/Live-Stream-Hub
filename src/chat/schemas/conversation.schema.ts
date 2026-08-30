import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

@Schema({ timestamps: true })
export class Conversation extends Document {
  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId, ref: 'User' }],
    required: true,
  })
  participants: string[];

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'DirectMessage' })
  lastMessage: string;

  // We could store unread counts here or calculate it dynamically
  @Prop({ type: Map, of: Number, default: {} })
  unreadCounts: Map<string, number>;

  createdAt: Date;
  updatedAt: Date;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);

// Index to quickly find conversations for a user
ConversationSchema.index({ participants: 1, updatedAt: -1 });

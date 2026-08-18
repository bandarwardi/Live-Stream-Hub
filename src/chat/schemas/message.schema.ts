import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

@Schema({ timestamps: true })
export class Message extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Broadcast', required: true })
  broadcast: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  sender: string;

  @Prop({ required: true, maxlength: 500 })
  text: string;

  @Prop({ required: true, enum: ['message', 'system', 'gift'], default: 'message' })
  type: string;

  // Timestamps will auto-add createdAt and updatedAt
  createdAt: Date;
  updatedAt: Date;
}

export const MessageSchema = SchemaFactory.createForClass(Message);

// Indexes
MessageSchema.index({ broadcast: 1, createdAt: 1 }); // Fast retrieval of messages for a room
MessageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 * 7 }); // Auto-delete messages after 7 days

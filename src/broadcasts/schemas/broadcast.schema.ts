import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

@Schema({ timestamps: true })
export class Broadcast extends Document {
  @Prop({ required: true, maxlength: 200 })
  title: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  broadcaster: string;

  @Prop({ required: true, unique: true, maxlength: 100 })
  channelName: string;

  @Prop({ required: true, maxlength: 50 })
  category: string;

  @Prop({ default: null })
  thumbnailUrl: string;

  @Prop({ default: true })
  isLive: boolean;

  @Prop({ default: 0 })
  viewerCount: number;

  @Prop({ default: 0 })
  peakViewerCount: number;

  @Prop({ maxlength: 500, default: '' })
  description: string;

  @Prop({ default: Date.now })
  lastHeartbeat: Date;

  @Prop({ default: Date.now })
  startedAt: Date;

  @Prop({ default: null })
  endedAt: Date;
}

export const BroadcastSchema = SchemaFactory.createForClass(Broadcast);

// Indexes
BroadcastSchema.index({ isLive: 1, startedAt: -1 });
BroadcastSchema.index({ broadcaster: 1, startedAt: -1 });
BroadcastSchema.index({ lastHeartbeat: 1 });
BroadcastSchema.index({ category: 1, isLive: 1, startedAt: -1 });
BroadcastSchema.index({ title: 'text' });

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

@Schema({ _id: false })
export class VoiceSeat {
  @Prop({ type: Number, required: true })
  index: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  userId: string | null;

  @Prop({ type: String, default: null })
  displayName: string | null;

  @Prop({ type: String, default: null })
  username: string | null;

  @Prop({ type: String, default: null })
  avatarUrl: string | null;

  @Prop({ type: Boolean, default: false })
  isMuted: boolean;

  @Prop({ type: Boolean, default: false })
  isLocked: boolean;
}

export const VoiceSeatSchema = SchemaFactory.createForClass(VoiceSeat);

@Schema({ timestamps: true })
export class VoiceRoom extends Document {
  @Prop({ type: String, required: true, maxlength: 200 })
  title: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  host: string;

  @Prop({ type: String, required: true, unique: true, maxlength: 100 })
  channelName: string;

  @Prop({ type: String, required: true, maxlength: 50, default: 'ChitChat' })
  category: string;

  @Prop({ type: String, default: null })
  coverUrl: string | null;

  @Prop({ type: Number, default: 8, min: 4, max: 12 })
  maxSeats: number; // 4, 8, or 12 guest seats (plus host seat 0)

  @Prop({ type: [VoiceSeatSchema], default: [] })
  seats: VoiceSeat[];

  @Prop({ type: Boolean, default: true })
  isLive: boolean;

  @Prop({
    type: String,
    enum: ['live', 'disconnected', 'ended'],
    default: 'live',
  })
  status: string;

  @Prop({ type: Date, default: null })
  disconnectedAt: Date | null;

  @Prop({ type: Number, default: 0 })
  viewerCount: number;

  @Prop({ type: Number, default: 0 })
  peakViewerCount: number;

  @Prop({ type: Number, default: 0 })
  totalGiftsReceived: number; // For room ranking by gifts

  @Prop({ type: String, maxlength: 500, default: '' })
  description: string;

  @Prop({ type: Date, default: Date.now })
  lastHeartbeat: Date;

  @Prop({ type: Date, default: Date.now })
  startedAt: Date;

  @Prop({ type: Date, default: null })
  endedAt: Date | null;
}

export const VoiceRoomSchema = SchemaFactory.createForClass(VoiceRoom);

// Indexes
VoiceRoomSchema.index({ isLive: 1, startedAt: -1 });
VoiceRoomSchema.index({ isLive: 1, viewerCount: -1 });
VoiceRoomSchema.index({ isLive: 1, totalGiftsReceived: -1 });
VoiceRoomSchema.index({ host: 1, startedAt: -1 });
VoiceRoomSchema.index({ lastHeartbeat: 1 });
VoiceRoomSchema.index({ title: 'text' });

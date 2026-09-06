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

  @Prop({
    type: String,
    enum: ['live', 'disconnected', 'ended'],
    default: 'live',
  })
  status: string;

  @Prop({ default: null })
  disconnectedAt: Date;

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

  @Prop({
    type: {
      status: {
        type: String,
        enum: ['idle', 'invited', 'active', 'ended'],
        default: 'idle',
      },
      opponentBroadcastId: {
        type: MongooseSchema.Types.ObjectId,
        ref: 'Broadcast',
        default: null,
      },
      opponentUserId: {
        type: MongooseSchema.Types.ObjectId,
        ref: 'User',
        default: null,
      },
      startedAt: { type: Date, default: null },
      endsAt: { type: Date, default: null },
      durationSeconds: { type: Number, default: 600 },
      scores: {
        hostA: { type: Number, default: 0 },
        hostB: { type: Number, default: 0 },
      },
      winnerId: {
        type: MongooseSchema.Types.ObjectId,
        ref: 'User',
        default: null,
      },
      result: {
        type: String,
        enum: ['hostA', 'hostB', 'draw', null],
        default: null,
      },
      inviteExpiresAt: { type: Date, default: null },
      topGifters: {
        type: [
          {
            userId: { type: MongooseSchema.Types.ObjectId, ref: 'User' },
            username: { type: String, default: '' },
            displayName: { type: String, default: '' },
            avatarUrl: { type: String, default: '' },
            totalCoins: { type: Number, default: 0 },
            side: { type: String, enum: ['hostA', 'hostB'] },
          },
        ],
        default: [],
      },
    },
    default: () => ({
      status: 'idle',
      opponentBroadcastId: null,
      opponentUserId: null,
      pkRole: null,
      startedAt: null,
      endsAt: null,
      durationSeconds: 600,
      scores: { hostA: 0, hostB: 0 },
      winnerId: null,
      result: null,
      inviteExpiresAt: null,
      topGifters: [],
    }),
  })
  pk: {
    status: 'idle' | 'invited' | 'active' | 'ended';
    pkRole?: 'hostA' | 'hostB' | null;
    opponentBroadcastId: any;
    opponentUserId: any;
    startedAt: Date | null;
    endsAt: Date | null;
    durationSeconds: number;
    scores: { hostA: number; hostB: number };
    winnerId: any;
    result: 'hostA' | 'hostB' | 'draw' | null;
    inviteExpiresAt: Date | null;
    topGifters?: Array<{
      userId: any;
      username: string;
      displayName: string;
      avatarUrl: string;
      totalCoins: number;
      side: 'hostA' | 'hostB';
    }>;
  };
}

export const BroadcastSchema = SchemaFactory.createForClass(Broadcast);

// Indexes
BroadcastSchema.index({ isLive: 1, startedAt: -1 });
BroadcastSchema.index({ broadcaster: 1, startedAt: -1 });
BroadcastSchema.index({ lastHeartbeat: 1 });
BroadcastSchema.index({ category: 1, isLive: 1, startedAt: -1 });
BroadcastSchema.index({ 'pk.status': 1 });
BroadcastSchema.index({ title: 'text' });

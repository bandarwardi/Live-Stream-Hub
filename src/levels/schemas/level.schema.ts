import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class Level extends Document {
  @Prop({ required: true, unique: true, min: 1 })
  level: number;

  @Prop({ required: true, maxlength: 100 })
  name: string;

  @Prop({ default: '⭐' })
  emoji: string;

  @Prop({ required: true, min: 0 })
  minXP: number;

  @Prop({ required: true, min: 0 })
  maxXP: number;

  @Prop({ default: '#FFFFFF' })
  color: string;

  @Prop({ default: null })
  badgeUrl: string;

  @Prop({ default: 0 })
  rewardCoins: number;

  @Prop({ default: 0 })
  rewardDiamonds: number;

  @Prop({ default: null })
  rewardStoreItem: string;

  @Prop({ type: [String], default: [] })
  perks: string[];
}

export const LevelSchema = SchemaFactory.createForClass(Level);
LevelSchema.index({ level: 1 });
LevelSchema.index({ minXP: 1, maxXP: 1 });


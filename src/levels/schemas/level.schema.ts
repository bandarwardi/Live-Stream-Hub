import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class Level extends Document {
  @Prop({ required: true, unique: true, min: 1 })
  level: number;

  @Prop({ required: true, maxlength: 100 })
  name: string;

  @Prop({ required: true, min: 0 })
  minXP: number;

  @Prop({ default: '#FFFFFF' })
  color: string;

  @Prop({ default: null })
  badgeUrl: string;
}

export const LevelSchema = SchemaFactory.createForClass(Level);

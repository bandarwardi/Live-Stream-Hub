import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class Banner extends Document {
  @Prop({ required: false })
  title?: string;

  @Prop({ required: true })
  imageUrl: string;

  @Prop({ required: false })
  linkUrl?: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: 0 })
  sortOrder: number;
}

export const BannerSchema = SchemaFactory.createForClass(Banner);

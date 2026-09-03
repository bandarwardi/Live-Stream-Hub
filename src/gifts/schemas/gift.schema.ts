import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class Gift extends Document {
  @Prop({ required: true, maxlength: 100 })
  name: string;

  @Prop({ maxlength: 500, default: '' })
  description: string;

  @Prop({ required: true, min: 1 })
  price: number; // Price in coins

  @Prop({ required: true })
  imageUrl: string;

  @Prop({ default: null })
  animationUrl: string; // Optional SVGA/Lottie animation

  @Prop({ default: true })
  isActive: boolean;
}

export const GiftSchema = SchemaFactory.createForClass(Gift);

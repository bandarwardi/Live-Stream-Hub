import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

@Schema({ timestamps: true })
export class SeatRequest extends Document {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'VoiceRoom',
    required: true,
  })
  roomId: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  user: string;

  @Prop({ default: -1 })
  seatIndex: number; // -1 means any available seat

  @Prop({
    type: String,
    enum: ['pending', 'accepted', 'rejected', 'cancelled'],
    default: 'pending',
  })
  status: string;
}

export const SeatRequestSchema = SchemaFactory.createForClass(SeatRequest);

SeatRequestSchema.index({ roomId: 1, status: 1 });
SeatRequestSchema.index({ roomId: 1, user: 1 });

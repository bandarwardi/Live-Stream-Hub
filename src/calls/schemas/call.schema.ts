import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { User } from '../../users/schemas/user.schema';

@Schema({ timestamps: true })
export class Call extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  caller: User;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  callee: User;

  @Prop({ required: true, enum: ['voice', 'video'] })
  type: string;

  @Prop({
    required: true,
    enum: ['ringing', 'active', 'ended', 'missed', 'rejected'],
    default: 'ringing',
  })
  status: string;

  @Prop({ required: true })
  channelName: string;

  @Prop({ default: null })
  startedAt: Date;

  @Prop({ default: null })
  endedAt: Date;

  @Prop({ default: 0 })
  duration: number; // in seconds
}

export const CallSchema = SchemaFactory.createForClass(Call);

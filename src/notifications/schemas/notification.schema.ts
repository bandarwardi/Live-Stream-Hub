import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type NotificationDocument = Notification & Document;

export enum NotificationType {
  SYSTEM = 'SYSTEM',
  NEW_FOLLOWER = 'NEW_FOLLOWER',
  GIFT_RECEIVED = 'GIFT_RECEIVED',
  PK_INVITE = 'PK_INVITE',
  PK_RESULT = 'PK_RESULT',
  LEVEL_UP = 'LEVEL_UP',
  CALL_MISSED = 'CALL_MISSED',
  ADMIN_ALERT = 'ADMIN_ALERT',
}

@Schema({ timestamps: true })
export class Notification {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  recipient: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  sender?: Types.ObjectId;

  @Prop({
    type: String,
    enum: NotificationType,
    default: NotificationType.SYSTEM,
    required: true,
  })
  type: NotificationType;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  message: string;

  @Prop({ type: Object, default: {} })
  data?: Record<string, any>;

  @Prop({ default: false, index: true })
  isRead: boolean;

  @Prop({ default: null })
  readAt?: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

NotificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
NotificationSchema.index({ recipient: 1, createdAt: -1 });

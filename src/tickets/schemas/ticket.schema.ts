import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

@Schema({ timestamps: true })
export class TicketReply {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  senderId: string; // Could be the user or an admin

  @Prop({ required: true })
  message: string;

  @Prop({ default: Date.now })
  createdAt: Date;
}

const TicketReplySchema = SchemaFactory.createForClass(TicketReply);

@Schema({ timestamps: true })
export class Ticket extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  user: string;

  @Prop({ required: true, maxlength: 200 })
  subject: string;

  @Prop({ required: true, maxlength: 2000 })
  message: string;

  @Prop({
    type: String,
    enum: ['open', 'in_progress', 'closed'],
    default: 'open',
  })
  status: string;

  @Prop({
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium',
  })
  priority: string;

  @Prop({ type: [TicketReplySchema], default: [] })
  replies: TicketReply[];
}

export const TicketSchema = SchemaFactory.createForClass(Ticket);

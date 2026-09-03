import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

@Schema({ timestamps: true })
export class Transaction extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  user: string;

  @Prop({ required: true })
  amount: number; // positive for gain, negative for spend

  @Prop({
    required: true,
    enum: [
      'deposit',
      'withdrawal',
      'gift_sent',
      'gift_received',
      'store_purchase',
      'admin_adjustment',
      'other',
    ],
  })
  type: string;

  @Prop({ default: null })
  referenceId: string; // E.g. Stripe charge ID, Gift ID, Broadcast ID

  @Prop({ required: true, maxlength: 255 })
  description: string;

  @Prop({
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'completed',
  })
  status: string;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);

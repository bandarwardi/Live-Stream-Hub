import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

@Schema({ timestamps: true })
export class Report extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  reporter: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  reportedUser: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Broadcast', default: null })
  reportedBroadcast: string;

  @Prop({ required: true, maxlength: 100 })
  reason: string;

  @Prop({ maxlength: 1000, default: '' })
  details: string;

  @Prop({
    type: String,
    enum: ['pending', 'reviewed', 'dismissed'],
    default: 'pending',
  })
  status: string;

  @Prop({ maxlength: 500, default: '' })
  actionTaken: string;
}

export const ReportSchema = SchemaFactory.createForClass(Report);

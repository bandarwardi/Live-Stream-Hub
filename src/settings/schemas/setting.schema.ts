import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

@Schema({ timestamps: true })
export class Setting extends Document {
  @Prop({ required: true, unique: true, maxlength: 100 })
  key: string;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  value: any;

  @Prop({ maxlength: 500, default: '' })
  description: string;
}

export const SettingSchema = SchemaFactory.createForClass(Setting);

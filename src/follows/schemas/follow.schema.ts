import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

@Schema({ timestamps: true })
export class Follow extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  follower: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  following: string;
}

export const FollowSchema = SchemaFactory.createForClass(Follow);

// Indexes
FollowSchema.index({ follower: 1, following: 1 }, { unique: true });
FollowSchema.index({ following: 1 });

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class User extends Document {
  @Prop({ required: false, unique: true, sparse: true })
  username: string;

  @Prop({ required: false, unique: true, lowercase: true, sparse: true })
  email: string;

  @Prop({ required: false, default: false })
  emailVerified: boolean;

  @Prop({ required: false, unique: true, sparse: true })
  phone: string;

  @Prop({ required: false, default: false })
  phoneVerified: boolean;

  @Prop({ required: false, default: null })
  passwordHash: string;

  @Prop({
    required: true,
    enum: ['local', 'google', 'phone', 'firebase'],
    default: 'local',
  })
  authProvider: string;

  @Prop({ unique: true, sparse: true })
  firebaseUid: string;

  @Prop({ default: null })
  bio: string;

  @Prop({ default: null })
  avatarUrl: string;

  @Prop({ default: null })
  coverUrl: string;

  @Prop({ default: null })
  displayName: string;

  @Prop({ default: 0 })
  coins: number;

  @Prop({ default: 0 })
  diamonds: number;

  @Prop({ default: false })
  isDeleted: boolean;

  @Prop({ default: false })
  isBanned: boolean;

  @Prop({ default: null })
  deletedAt: Date;

  @Prop({ default: null })
  deletionGracePeriodUntil: Date;

  @Prop({ default: null })
  usernameReservedUntil: Date;

  @Prop({ default: null })
  originalUsername: string;

  @Prop({ default: null })
  gender: string;

  @Prop({ default: null })
  birthdate: Date;

  @Prop({ default: false })
  isProfileComplete: boolean;
  // Used for tracking the family of refresh tokens for reuse detection
  @Prop({ default: null })
  refreshTokenFamily: string;

  @Prop({ default: null })
  hashedRefreshToken: string;

  @Prop({ default: null })
  pushToken: string;

  @Prop({ default: false })
  isOnline: boolean;

  @Prop({ default: null })
  lastSeen: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.set('toJSON', {
  transform: function (doc, ret) {
    delete (ret as any).passwordHash;
    delete (ret as any).hashedRefreshToken;
    delete (ret as any).refreshTokenFamily;
    return ret;
  },
});

// Indexes
UserSchema.index({ username: 'text', bio: 'text' });

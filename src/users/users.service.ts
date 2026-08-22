import { Injectable, ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from './schemas/user.schema';
import { FirebaseService } from '../firebase/firebase.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    private firebaseService: FirebaseService,
  ) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.userModel.findOne({ email, isDeleted: { $ne: true } }).exec();
  }

  async findByPhone(phone: string): Promise<User | null> {
    return this.userModel.findOne({ phone, isDeleted: { $ne: true } }).exec();
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.userModel.findOne({ username, isDeleted: { $ne: true } }).exec();
  }

  async findById(id: string): Promise<User | null> {
    return this.userModel.findById(id).exec();
  }

  async searchUsers(query: string) {
    if (!query) return [];
    // Searching by text index or regex
    return this.userModel
      .find({
        $or: [
          { displayName: { $regex: query, $options: 'i' } },
          { username: { $regex: query, $options: 'i' } },
        ],
        isDeleted: { $ne: true },
      })
      .limit(20)
      .select('username displayName avatarUrl bio')
      .exec();
  }

  async findByFirebaseUid(firebaseUid: string): Promise<User | null> {
    return this.userModel.findOne({ firebaseUid, isDeleted: { $ne: true } }).exec();
  }

  async findAnyByFirebaseUid(firebaseUid: string): Promise<User | null> {
    return this.userModel.findOne({ firebaseUid }).exec();
  }

  async create(user: Partial<User>): Promise<User> {
    const newUser = new this.userModel(user);
    return newUser.save();
  }

  async updateRefreshTokenFamily(userId: string, family: string | null, hashedToken: string | null): Promise<void> {
    await this.userModel.findByIdAndUpdate(userId, { 
      refreshTokenFamily: family,
      hashedRefreshToken: hashedToken 
    }).exec();
  }

  async findOrCreateByFirebaseUid(uid: string, defaults: Partial<User>): Promise<User> {
    return this.userModel.findOneAndUpdate(
      { firebaseUid: uid },
      { $setOnInsert: { firebaseUid: uid, ...defaults } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).exec();
  }

  async findLinkableAccount(tokenEmail?: string, tokenPhone?: string): Promise<User | null> {
    if (tokenEmail) {
      const byEmail = await this.userModel.findOne({
        email: tokenEmail,
        emailVerified: true,
        isDeleted: { $ne: true },
      });
      if (byEmail) return byEmail;
    }
    if (tokenPhone) {
      const byPhone = await this.userModel.findOne({
        phone: tokenPhone,
        phoneVerified: true,
        isDeleted: { $ne: true },
      });
      if (byPhone) return byPhone;
    }
    return null;
  }

  async findAnyLinkableAccount(tokenEmail?: string, tokenPhone?: string): Promise<User | null> {
    if (tokenEmail) {
      const byEmail = await this.userModel.findOne({
        email: tokenEmail,
        emailVerified: true,
      });
      if (byEmail) return byEmail;
    }
    if (tokenPhone) {
      const byPhone = await this.userModel.findOne({
        phone: tokenPhone,
        phoneVerified: true,
      });
      if (byPhone) return byPhone;
    }
    return null;
  }

  async updateProfile(userId: string, data: Partial<User>) {
    try {
      return await this.userModel.findByIdAndUpdate(userId, data, { new: true }).exec();
    } catch (err: any) {
      if (err.code === 11000) {
        const field = Object.keys(err.keyPattern)[0];
        throw new ConflictException(`هذا ال${field} مستخدم بالفعل من قبل حساب آخر`);
      }
      throw err;
    }
  }

  async softDeleteUser(userId: string): Promise<{ success: true }> {
    const user = await this.userModel.findById(userId);
    if (!user || user.isDeleted) {
      throw new NotFoundException('الحساب غير موجود');
    }

    user.isDeleted = true;
    user.deletedAt = new Date();
    
    // 7 days grace period
    const graceDate = new Date();
    graceDate.setDate(graceDate.getDate() + 7);
    user.deletionGracePeriodUntil = graceDate;

    // 30 days username reservation
    const reserveDate = new Date();
    reserveDate.setDate(reserveDate.getDate() + 30);
    user.usernameReservedUntil = reserveDate;
    user.originalUsername = user.username;

    // Clear active sessions
    user.hashedRefreshToken = null as any;
    user.refreshTokenFamily = null as any;
    
    await user.save();
    return { success: true };
  }
  async verifyPhoneFromFirebaseToken(userId: string, token: string) {
    try {
      const decodedToken = await this.firebaseService.getAuth().verifyIdToken(token);
      const phoneNumber = decodedToken.phone_number;
      
      if (!phoneNumber) {
        throw new BadRequestException('Token does not contain a phone number');
      }

      // Check if this phone number is already verified by ANOTHER user
      const existingUser = await this.userModel.findOne({ 
        phone: phoneNumber, 
        phoneVerified: true,
        isDeleted: { $ne: true },
        _id: { $ne: userId }
      });

      if (existingUser) {
        throw new ConflictException('هذا الرقم مستخدم وموثق في حساب آخر');
      }

      return await this.userModel.findByIdAndUpdate(
        userId,
        {
          phone: phoneNumber,
          phoneVerified: true,
        },
        { new: true }
      ).exec();
    } catch (error: any) {
      if (error instanceof ConflictException || error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('فشل التحقق من الرمز مع Firebase');
    }
  }

  async deductCoins(userId: string, amount: number): Promise<boolean> {
    const result = await this.userModel.findOneAndUpdate(
      { _id: userId, coins: { $gte: amount } },
      { $inc: { coins: -amount } },
      { new: true }
    ).exec();
    return !!result;
  }

  async addCoins(userId: string, amount: number): Promise<void> {
    await this.userModel.findByIdAndUpdate(userId, { $inc: { coins: amount } }).exec();
  }
}

import { Injectable, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Follow } from './schemas/follow.schema';

@Injectable()
export class FollowsService {
  constructor(@InjectModel(Follow.name) private followModel: Model<Follow>) {}

  async follow(followerId: string, followingId: string): Promise<void> {
    if (followerId === followingId) {
      throw new ConflictException('You cannot follow yourself');
    }

    try {
      await this.followModel.create({
        follower: followerId,
        following: followingId,
      });
    } catch (error: any) {
      if (error.code === 11000) {
        // Already following, ignore
        return;
      }
      throw error;
    }
  }

  async unfollow(followerId: string, followingId: string): Promise<void> {
    await this.followModel
      .deleteOne({
        follower: followerId,
        following: followingId,
      })
      .exec();
  }

  async isFollowing(followerId: string, followingId: string): Promise<boolean> {
    if (!followerId) return false;
    const follow = await this.followModel.exists({
      follower: followerId,
      following: followingId,
    });
    return !!follow;
  }

  async getFollowers(userId: string) {
    const follows = await this.followModel
      .find({ following: userId })
      .populate('follower', 'username displayName avatarUrl bio')
      .exec();

    return follows.map((f) => f.follower);
  }

  async getFollowing(userId: string) {
    const follows = await this.followModel
      .find({ follower: userId })
      .populate('following', 'username displayName avatarUrl bio')
      .exec();

    return follows.map((f) => f.following);
  }

  async getFollowersCount(userId: string): Promise<number> {
    return this.followModel.countDocuments({ following: userId }).exec();
  }

  async getFollowingCount(userId: string): Promise<number> {
    return this.followModel.countDocuments({ follower: userId }).exec();
  }
}

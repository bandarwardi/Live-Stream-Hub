import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Transaction } from '../transactions/schemas/transaction.schema';
import { User } from '../users/schemas/user.schema';

export type LeaderboardPeriod = 'daily' | 'weekly' | 'monthly' | 'all_time';

@Injectable()
export class LeaderboardsService {
  constructor(
    @InjectModel(Transaction.name)
    private readonly transactionModel: Model<Transaction>,
    @InjectModel(User.name)
    private readonly userModel: Model<User>,
  ) {}

  private getDateFilter(period: LeaderboardPeriod): Date | null {
    const now = new Date();
    if (period === 'daily') {
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    } else if (period === 'weekly') {
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === 'monthly') {
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
    return null; // all_time
  }

  async getTopGifters(period: LeaderboardPeriod = 'weekly', limit: number = 50) {
    const cappedLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const startDate = this.getDateFilter(period);

    const matchQuery: any = {
      type: 'gift_sent',
      status: 'completed',
    };
    if (startDate) {
      matchQuery.createdAt = { $gte: startDate };
    }

    const pipeline: any[] = [
      { $match: matchQuery },
      {
        $group: {
          _id: '$user',
          totalAmount: { $sum: { $abs: '$amount' } },
          giftsCount: { $sum: 1 },
        },
      },
      { $sort: { totalAmount: -1 } },
      { $limit: cappedLimit },
      {
        $lookup: {
          from: 'users',
          let: { uId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: ['$_id', '$$uId'] },
                    { $eq: [{ $toString: '$_id' }, { $toString: '$$uId' }] },
                  ],
                },
              },
            },
          ],
          as: 'userInfo',
        },
      },
      { $unwind: '$userInfo' },
      {
        $match: {
          'userInfo.isBanned': { $ne: true },
          'userInfo.isDeleted': { $ne: true },
        },
      },
      {
        $project: {
          _id: 0,
          userId: '$_id',
          score: '$totalAmount',
          giftsCount: '$giftsCount',
          username: '$userInfo.username',
          displayName: '$userInfo.displayName',
          avatarUrl: '$userInfo.avatarUrl',
          level: '$userInfo.currentLevel',
          levelBadgeUrl: '$userInfo.levelBadgeUrl',
        },
      },
    ];

    let results = await this.transactionModel.aggregate(pipeline).exec();

    return results.map((item, index) => ({
      ...item,
      rank: index + 1,
    }));
  }

  async getTopBroadcasters(period: LeaderboardPeriod = 'weekly', limit: number = 50) {
    const cappedLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const startDate = this.getDateFilter(period);

    const matchQuery: any = {
      type: 'gift_received',
      status: 'completed',
    };
    if (startDate) {
      matchQuery.createdAt = { $gte: startDate };
    }

    const pipeline: any[] = [
      { $match: matchQuery },
      {
        $group: {
          _id: '$user',
          totalAmount: { $sum: '$amount' },
          giftsCount: { $sum: 1 },
        },
      },
      { $sort: { totalAmount: -1 } },
      { $limit: cappedLimit },
      {
        $lookup: {
          from: 'users',
          let: { uId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: ['$_id', '$$uId'] },
                    { $eq: [{ $toString: '$_id' }, { $toString: '$$uId' }] },
                  ],
                },
              },
            },
          ],
          as: 'userInfo',
        },
      },
      { $unwind: '$userInfo' },
      {
        $match: {
          'userInfo.isBanned': { $ne: true },
          'userInfo.isDeleted': { $ne: true },
        },
      },
      {
        $project: {
          _id: 0,
          userId: '$_id',
          score: '$totalAmount',
          giftsCount: '$giftsCount',
          username: '$userInfo.username',
          displayName: '$userInfo.displayName',
          avatarUrl: '$userInfo.avatarUrl',
          level: '$userInfo.currentLevel',
          levelBadgeUrl: '$userInfo.levelBadgeUrl',
        },
      },
    ];

    let results = await this.transactionModel.aggregate(pipeline).exec();

    // Fallback for all_time if transactions collection hasn't accumulated gift_received yet
    if (results.length === 0 && period === 'all_time') {
      const topUsers = await this.userModel
        .find({
          diamonds: { $gt: 0 },
          isBanned: { $ne: true },
          isDeleted: { $ne: true },
        })
        .sort({ diamonds: -1 })
        .limit(cappedLimit)
        .select(
          '_id username displayName avatarUrl currentLevel levelBadgeUrl diamonds',
        )
        .lean()
        .exec();

      results = topUsers.map((u) => ({
        userId: u._id,
        score: u.diamonds,
        giftsCount: 0,
        username: u.username,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        level: u.currentLevel,
        levelBadgeUrl: u.levelBadgeUrl,
      }));
    }

    return results.map((item, index) => ({
      ...item,
      rank: index + 1,
    }));
  }

  async getPkChampions(
    sortBy: 'streak' | 'wins' = 'streak',
    limit: number = 50,
  ) {
    const cappedLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);

    const sortObj: any =
      sortBy === 'wins'
        ? { pkWins: -1, pkWinStreak: -1, pkBestStreak: -1 }
        : { pkWinStreak: -1, pkBestStreak: -1, pkWins: -1 };

    const champions = await this.userModel
      .find({
        isBanned: { $ne: true },
        isDeleted: { $ne: true },
        $or: [
          { pkWins: { $gt: 0 } },
          { pkWinStreak: { $gt: 0 } },
          { pkBestStreak: { $gt: 0 } },
        ],
      })
      .sort(sortObj)
      .limit(cappedLimit)
      .select(
        '_id username displayName avatarUrl currentLevel levelBadgeUrl pkWins pkLosses pkDraws pkWinStreak pkBestStreak',
      )
      .lean()
      .exec();

    return champions.map((user, index) => ({
      userId: user._id,
      rank: index + 1,
      score: sortBy === 'wins' ? user.pkWins || 0 : user.pkWinStreak || 0,
      pkWins: user.pkWins || 0,
      pkLosses: user.pkLosses || 0,
      pkDraws: user.pkDraws || 0,
      pkWinStreak: user.pkWinStreak || 0,
      pkBestStreak: user.pkBestStreak || 0,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      level: user.currentLevel,
      levelBadgeUrl: user.levelBadgeUrl,
    }));
  }

  async getUserRank(
    userId: string,
    category: 'gifters' | 'broadcasters' | 'pk-champions',
    period: LeaderboardPeriod = 'weekly',
    sortBy: 'streak' | 'wins' = 'streak',
  ) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user ID');
    }

    let list: any[] = [];
    if (category === 'gifters') {
      list = await this.getTopGifters(period, 100);
    } else if (category === 'broadcasters') {
      list = await this.getTopBroadcasters(period, 100);
    } else {
      list = await this.getPkChampions(sortBy, 100);
    }

    const foundIndex = list.findIndex(
      (item) => item.userId?.toString() === userId.toString(),
    );

    if (foundIndex !== -1) {
      return {
        rank: foundIndex + 1,
        entry: list[foundIndex],
      };
    }

    // User is beyond rank 100 or unranked. Query user document to compute exact rank if score > 0
    const userDoc = await this.userModel.findById(userId).lean().exec();
    if (!userDoc || userDoc.isBanned || userDoc.isDeleted) {
      return { rank: null, entry: null };
    }

    const startDate = this.getDateFilter(period);
    const userIdObj = new Types.ObjectId(userId);
    let userScore = 0;
    let rank: number | null = null;

    if (category === 'gifters') {
      const matchQuery: any = {
        user: { $in: [userIdObj, userId.toString()] },
        type: 'gift_sent',
        status: 'completed',
      };
      if (startDate) matchQuery.createdAt = { $gte: startDate };

      const userAgg = await this.transactionModel
        .aggregate([
          { $match: matchQuery },
          { $group: { _id: null, total: { $sum: { $abs: '$amount' } } } },
        ])
        .exec();

      userScore = userAgg[0]?.total || 0;

      if (userScore > 0) {
        const higherMatch: any = {
          type: 'gift_sent',
          status: 'completed',
        };
        if (startDate) higherMatch.createdAt = { $gte: startDate };

        const higherAgg = await this.transactionModel
          .aggregate([
            { $match: higherMatch },
            { $group: { _id: '$user', total: { $sum: { $abs: '$amount' } } } },
            { $match: { total: { $gt: userScore } } },
            {
              $lookup: {
                from: 'users',
                let: { uId: '$_id' },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $or: [
                          { $eq: ['$_id', '$$uId'] },
                          { $eq: [{ $toString: '$_id' }, { $toString: '$$uId' }] },
                        ],
                      },
                    },
                  },
                ],
                as: 'userInfo',
              },
            },
            { $unwind: '$userInfo' },
            {
              $match: {
                'userInfo.isBanned': { $ne: true },
                'userInfo.isDeleted': { $ne: true },
              },
            },
            { $count: 'count' },
          ])
          .exec();

        rank = (higherAgg[0]?.count || 0) + 1;
      }
    } else if (category === 'broadcasters') {
      const matchQuery: any = {
        user: { $in: [userIdObj, userId.toString()] },
        type: 'gift_received',
        status: 'completed',
      };
      if (startDate) matchQuery.createdAt = { $gte: startDate };

      const userAgg = await this.transactionModel
        .aggregate([
          { $match: matchQuery },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ])
        .exec();

      userScore = userAgg[0]?.total || 0;

      if (userScore === 0 && period === 'all_time') {
        userScore = userDoc.diamonds || 0;
        if (userScore > 0) {
          const higherCount = await this.userModel
            .countDocuments({
              diamonds: { $gt: userScore },
              isBanned: { $ne: true },
              isDeleted: { $ne: true },
            })
            .exec();
          rank = higherCount + 1;
        }
      } else if (userScore > 0) {
        const higherMatch: any = {
          type: 'gift_received',
          status: 'completed',
        };
        if (startDate) higherMatch.createdAt = { $gte: startDate };

        const higherAgg = await this.transactionModel
          .aggregate([
            { $match: higherMatch },
            { $group: { _id: '$user', total: { $sum: '$amount' } } },
            { $match: { total: { $gt: userScore } } },
            {
              $lookup: {
                from: 'users',
                let: { uId: '$_id' },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $or: [
                          { $eq: ['$_id', '$$uId'] },
                          { $eq: [{ $toString: '$_id' }, { $toString: '$$uId' }] },
                        ],
                      },
                    },
                  },
                ],
                as: 'userInfo',
              },
            },
            { $unwind: '$userInfo' },
            {
              $match: {
                'userInfo.isBanned': { $ne: true },
                'userInfo.isDeleted': { $ne: true },
              },
            },
            { $count: 'count' },
          ])
          .exec();

        rank = (higherAgg[0]?.count || 0) + 1;
      }
    } else {
      // PK Champions
      userScore = sortBy === 'wins' ? userDoc.pkWins || 0 : userDoc.pkWinStreak || 0;
      if (userScore > 0) {
        const query: any = {
          isBanned: { $ne: true },
          isDeleted: { $ne: true },
        };
        if (sortBy === 'wins') {
          query.pkWins = { $gt: userScore };
        } else {
          query.pkWinStreak = { $gt: userScore };
        }
        const higherCount = await this.userModel.countDocuments(query).exec();
        rank = higherCount + 1;
      }
    }

    return {
      rank,
      entry: {
        userId: userDoc._id.toString(),
        username: userDoc.username,
        displayName: userDoc.displayName,
        avatarUrl: userDoc.avatarUrl,
        level: userDoc.currentLevel,
        levelBadgeUrl: userDoc.levelBadgeUrl,
        score: userScore,
        pkWins: userDoc.pkWins || 0,
        pkWinStreak: userDoc.pkWinStreak || 0,
      },
    };
  }
}

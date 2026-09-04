import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Level } from './schemas/level.schema';
import { CreateLevelDto } from './dto/create-level.dto';
import { UpdateLevelDto } from './dto/update-level.dto';
import { UsersService } from '../users/users.service';
import { StoreService } from '../store/store.service';

@Injectable()
export class LevelsService {
  constructor(
    @InjectModel(Level.name) private levelModel: Model<Level>,
    private readonly usersService: UsersService,
    private readonly storeService: StoreService,
  ) {}

  async create(createLevelDto: CreateLevelDto, badgeUrl?: string): Promise<Level> {
    const existing = await this.levelModel.findOne({ level: createLevelDto.level });
    if (existing) throw new ConflictException(`Level ${createLevelDto.level} already exists`);

    const createdLevel = new this.levelModel({
      ...createLevelDto,
      badgeUrl,
    });
    return createdLevel.save();
  }

  async findAll(): Promise<Level[]> {
    return this.levelModel.find().sort({ level: 1 }).exec();
  }

  async findAllForAdmin(): Promise<Level[]> {
    return this.findAll();
  }

  async findById(id: string): Promise<Level> {
    if (!id || !Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid level ID');
    }
    const level = await this.levelModel.findById(id).exec();
    if (!level) {
      throw new NotFoundException(`Level with ID ${id} not found`);
    }
    return level;
  }

  async findByLevel(level: number): Promise<Level | null> {
    return this.levelModel.findOne({ level }).exec();
  }

  async findLevelForXP(xp: number): Promise<Level | null> {
    return this.levelModel
      .findOne({ minXP: { $lte: xp } })
      .sort({ level: -1 })
      .exec();
  }

  async update(id: string, updateLevelDto: UpdateLevelDto, badgeUrl?: string): Promise<Level> {
    const levelObj = await this.findById(id);
    
    if (updateLevelDto.level !== undefined && updateLevelDto.level !== levelObj.level) {
      const existing = await this.levelModel.findOne({ level: updateLevelDto.level });
      if (existing) throw new ConflictException(`Level ${updateLevelDto.level} already exists`);
      levelObj.level = updateLevelDto.level;
    }
    
    if (updateLevelDto.name !== undefined) levelObj.name = updateLevelDto.name;
    if (updateLevelDto.emoji !== undefined) levelObj.emoji = updateLevelDto.emoji;
    if (updateLevelDto.minXP !== undefined) levelObj.minXP = updateLevelDto.minXP;
    if (updateLevelDto.maxXP !== undefined) levelObj.maxXP = updateLevelDto.maxXP;
    if (updateLevelDto.color !== undefined) levelObj.color = updateLevelDto.color;
    if (updateLevelDto.rewardCoins !== undefined) levelObj.rewardCoins = updateLevelDto.rewardCoins;
    if (updateLevelDto.rewardDiamonds !== undefined) levelObj.rewardDiamonds = updateLevelDto.rewardDiamonds;
    if (updateLevelDto.rewardStoreItem !== undefined) levelObj.rewardStoreItem = updateLevelDto.rewardStoreItem;
    if (updateLevelDto.perks !== undefined) levelObj.perks = updateLevelDto.perks;
    if (badgeUrl !== undefined) levelObj.badgeUrl = badgeUrl;

    return levelObj.save();
  }

  async remove(id: string): Promise<void> {
    if (!id || !Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid level ID');
    }
    const result = await this.levelModel.deleteOne({ _id: id }).exec();
    if (result.deletedCount === 0) {
      throw new NotFoundException(`Level with ID ${id} not found`);
    }
  }

  /**
   * Process gaining XP from an event (gift, watch, stream, daily login)
   * Handles multi-level progression and awards coins, diamonds, and store items.
   */
  async processXPGain(userId: string, xpAmount: number, source: string) {
    if (!Types.ObjectId.isValid(userId)) {
      return { leveledUp: false, error: 'Invalid user ID' };
    }

    const user = await this.usersService.findById(userId);
    if (!user) {
      return { leveledUp: false, error: 'User not found' };
    }

    const currentXP = user.xp || 0;
    const currentLevelNum = user.currentLevel || 1;
    const newXP = currentXP + xpAmount;

    // Atomically increment user XP
    await this.usersService.addXP(userId, xpAmount);

    // Find the level matching newXP
    const targetLevel = await this.levelModel
      .findOne({ minXP: { $lte: newXP } })
      .sort({ level: -1 })
      .exec();

    if (!targetLevel || targetLevel.level <= currentLevelNum) {
      return {
        leveledUp: false,
        oldLevel: currentLevelNum,
        currentLevel: currentLevelNum,
        xp: newXP,
        gainedXP: xpAmount,
        source,
      };
    }

    // LEVEL UP DETECTED!
    // Collect rewards for all intermediate levels passed
    const gainedLevels = await this.levelModel
      .find({
        level: { $gt: currentLevelNum, $lte: targetLevel.level },
      })
      .sort({ level: 1 })
      .exec();

    let totalRewardedCoins = 0;
    let totalRewardedDiamonds = 0;
    const rewardedStoreItems: any[] = [];

    for (const lvl of gainedLevels) {
      if (lvl.rewardCoins > 0) {
        totalRewardedCoins += lvl.rewardCoins;
      }
      if (lvl.rewardDiamonds > 0) {
        totalRewardedDiamonds += lvl.rewardDiamonds;
      }
      if (lvl.rewardStoreItem) {
        const storeItem = await this.storeService.findByName(lvl.rewardStoreItem);
        const itemPayload = {
          itemId: storeItem ? storeItem._id.toString() : lvl.rewardStoreItem,
          name: storeItem ? storeItem.name : lvl.rewardStoreItem,
          type: storeItem ? storeItem.type : 'frame',
          imageUrl: storeItem ? storeItem.imageUrl : undefined,
          animationUrl: storeItem ? storeItem.animationUrl : undefined,
          source: `level_${lvl.level}_reward`,
        };
        await this.usersService.addInventoryItem(userId, itemPayload);
        rewardedStoreItems.push(itemPayload);
      }
    }

    if (totalRewardedCoins > 0) {
      await this.usersService.addCoins(userId, totalRewardedCoins);
    }
    if (totalRewardedDiamonds > 0) {
      await this.usersService.addDiamonds(userId, totalRewardedDiamonds);
    }

    // Update user's current level & badge
    await this.usersService.updateLevel(
      userId,
      targetLevel.level,
      targetLevel.badgeUrl,
    );

    return {
      leveledUp: true,
      oldLevel: currentLevelNum,
      newLevel: targetLevel,
      xp: newXP,
      gainedXP: xpAmount,
      source,
      rewards: {
        coins: totalRewardedCoins,
        diamonds: totalRewardedDiamonds,
        storeItems: rewardedStoreItems,
      },
    };
  }

  /**
   * Get level progression details for a user
   */
  async getUserProgress(userId: string) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user ID');
    }

    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const currentXP = user.xp || 0;
    const currentLevelNum = user.currentLevel || 1;

    const currentLevel =
      (await this.findByLevel(currentLevelNum)) ||
      (await this.findLevelForXP(currentXP)) || {
        level: currentLevelNum,
        name: 'Seedling 🌱',
        minXP: 0,
        maxXP: 99,
        color: '#9E9E9E',
        badgeUrl: null,
      };

    const nextLevel = await this.findByLevel(currentLevel.level + 1);

    const xpForCurrentTier = currentXP - currentLevel.minXP;
    const xpNeededForNext = nextLevel ? nextLevel.minXP - currentLevel.minXP : 1;
    const progressPercent = nextLevel
      ? Math.min(100, Math.max(0, Math.round((xpForCurrentTier / xpNeededForNext) * 100)))
      : 100;

    return {
      userId,
      xp: currentXP,
      currentLevel,
      nextLevel: nextLevel || null,
      progressPercent,
      xpToNextLevel: nextLevel ? Math.max(0, nextLevel.minXP - currentXP) : 0,
      inventory: user.inventory || [],
    };
  }
}


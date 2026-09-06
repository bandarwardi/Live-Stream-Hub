import {
  Controller,
  Get,
  Query,
  BadRequestException,
} from '@nestjs/common';
import {
  LeaderboardsService,
  LeaderboardPeriod,
} from './leaderboards.service';
import { Types } from 'mongoose';

@Controller('leaderboards')
export class LeaderboardsController {
  constructor(private readonly leaderboardsService: LeaderboardsService) {}

  @Get('gifters')
  async getTopGifters(
    @Query('period') period?: string,
    @Query('limit') limit?: string,
  ) {
    const validPeriods: LeaderboardPeriod[] = [
      'daily',
      'weekly',
      'monthly',
      'all_time',
    ];
    const selectedPeriod: LeaderboardPeriod =
      period && validPeriods.includes(period as LeaderboardPeriod)
        ? (period as LeaderboardPeriod)
        : 'weekly';

    const parsedLimit = limit ? parseInt(limit, 10) : 50;

    return this.leaderboardsService.getTopGifters(selectedPeriod, parsedLimit);
  }

  @Get('broadcasters')
  async getTopBroadcasters(
    @Query('period') period?: string,
    @Query('limit') limit?: string,
  ) {
    const validPeriods: LeaderboardPeriod[] = [
      'daily',
      'weekly',
      'monthly',
      'all_time',
    ];
    const selectedPeriod: LeaderboardPeriod =
      period && validPeriods.includes(period as LeaderboardPeriod)
        ? (period as LeaderboardPeriod)
        : 'weekly';

    const parsedLimit = limit ? parseInt(limit, 10) : 50;

    return this.leaderboardsService.getTopBroadcasters(
      selectedPeriod,
      parsedLimit,
    );
  }

  @Get('pk-champions')
  async getPkChampions(
    @Query('sortBy') sortBy?: string,
    @Query('limit') limit?: string,
  ) {
    const validSorts: ('streak' | 'wins')[] = ['streak', 'wins'];
    const selectedSort =
      sortBy && validSorts.includes(sortBy as any)
        ? (sortBy as 'streak' | 'wins')
        : 'streak';

    const parsedLimit = limit ? parseInt(limit, 10) : 50;

    return this.leaderboardsService.getPkChampions(selectedSort, parsedLimit);
  }

  @Get('user-rank')
  async getUserRank(
    @Query('userId') userId: string,
    @Query('category') category: string,
    @Query('period') period?: string,
    @Query('sortBy') sortBy?: string,
  ) {
    if (!userId) {
      throw new BadRequestException('userId is required');
    }
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid userId');
    }

    const validCategories = ['gifters', 'broadcasters', 'pk-champions'];
    const selectedCategory = validCategories.includes(category)
      ? category
      : 'gifters';

    const validPeriods: LeaderboardPeriod[] = [
      'daily',
      'weekly',
      'monthly',
      'all_time',
    ];
    const selectedPeriod: LeaderboardPeriod =
      period && validPeriods.includes(period as LeaderboardPeriod)
        ? (period as LeaderboardPeriod)
        : 'weekly';

    const validSorts: ('streak' | 'wins')[] = ['streak', 'wins'];
    const selectedSort =
      sortBy && validSorts.includes(sortBy as any)
        ? (sortBy as 'streak' | 'wins')
        : 'streak';

    return this.leaderboardsService.getUserRank(
      userId,
      selectedCategory as any,
      selectedPeriod,
      selectedSort,
    );
  }
}

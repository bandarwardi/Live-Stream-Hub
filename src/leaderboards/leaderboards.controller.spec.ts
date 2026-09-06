import { Test, TestingModule } from '@nestjs/testing';
import { LeaderboardsController } from './leaderboards.controller';
import { LeaderboardsService } from './leaderboards.service';

describe('LeaderboardsController', () => {
  let controller: LeaderboardsController;

  const mockLeaderboardsService = {
    getTopGifters: jest.fn().mockResolvedValue([]),
    getTopBroadcasters: jest.fn().mockResolvedValue([]),
    getPkChampions: jest.fn().mockResolvedValue([]),
    getUserRank: jest.fn().mockResolvedValue({ rank: null, entry: null }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LeaderboardsController],
      providers: [
        {
          provide: LeaderboardsService,
          useValue: mockLeaderboardsService,
        },
      ],
    }).compile();

    controller = module.get<LeaderboardsController>(LeaderboardsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should call getTopGifters', async () => {
    await controller.getTopGifters('weekly', '10');
    expect(mockLeaderboardsService.getTopGifters).toHaveBeenCalledWith(
      'weekly',
      10,
    );
  });

  it('should call getTopBroadcasters', async () => {
    await controller.getTopBroadcasters('monthly', '20');
    expect(mockLeaderboardsService.getTopBroadcasters).toHaveBeenCalledWith(
      'monthly',
      20,
    );
  });

  it('should call getPkChampions', async () => {
    await controller.getPkChampions('wins', '30');
    expect(mockLeaderboardsService.getPkChampions).toHaveBeenCalledWith(
      'wins',
      30,
    );
  });
});

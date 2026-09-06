import { Test, TestingModule } from '@nestjs/testing';
import { LeaderboardsService } from './leaderboards.service';
import { getModelToken } from '@nestjs/mongoose';
import { Transaction } from '../transactions/schemas/transaction.schema';
import { User } from '../users/schemas/user.schema';

describe('LeaderboardsService', () => {
  let service: LeaderboardsService;

  const mockTransactionModel = {
    aggregate: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue([
        {
          userId: '60d5ec49f1b2c8b1f8e4e1a1',
          score: 5000,
          giftsCount: 10,
          username: 'rich_user',
          displayName: 'Top Gifter',
        },
      ]),
    }),
  };

  const mockUserModel = {
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            lean: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue([
                {
                  _id: '60d5ec49f1b2c8b1f8e4e1a2',
                  username: 'champion1',
                  displayName: 'PK Champ',
                  pkWinStreak: 12,
                  pkWins: 45,
                },
              ]),
            }),
          }),
        }),
      }),
    }),
    findById: jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      }),
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaderboardsService,
        {
          provide: getModelToken(Transaction.name),
          useValue: mockTransactionModel,
        },
        {
          provide: getModelToken(User.name),
          useValue: mockUserModel,
        },
      ],
    }).compile();

    service = module.get<LeaderboardsService>(LeaderboardsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return ranked top gifters', async () => {
    const res = await service.getTopGifters('weekly', 10);
    expect(res).toBeDefined();
    expect(Array.isArray(res)).toBe(true);
    expect(res[0].rank).toBe(1);
    expect(res[0].score).toBe(5000);
  });

  it('should return ranked top broadcasters', async () => {
    const res = await service.getTopBroadcasters('weekly', 10);
    expect(res).toBeDefined();
    expect(Array.isArray(res)).toBe(true);
    expect(res[0].rank).toBe(1);
  });

  it('should return PK champions sorted by streak', async () => {
    const res = await service.getPkChampions('streak', 10);
    expect(res).toBeDefined();
    expect(Array.isArray(res)).toBe(true);
    expect(res[0].rank).toBe(1);
    expect(res[0].score).toBe(12);
  });

  it('should return user rank when found in top list', async () => {
    const res = await service.getUserRank(
      '60d5ec49f1b2c8b1f8e4e1a1',
      'gifters',
      'weekly',
    );
    expect(res).toBeDefined();
    expect(res.rank).toBe(1);
    expect(res.entry.score).toBe(5000);
  });

  it('should support getUserRank for pk-champions with wins sortBy', async () => {
    const res = await service.getUserRank(
      '60d5ec49f1b2c8b1f8e4e1a2',
      'pk-champions',
      'weekly',
      'wins',
    );
    expect(res).toBeDefined();
    expect(res.rank).toBe(1);
  });
});

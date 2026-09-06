import {
  Injectable,
  ConflictException,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Broadcast } from './schemas/broadcast.schema';
import { CreateBroadcastDto } from './dto/create-broadcast.dto';
import { RtcTokenBuilder, RtcRole } from 'agora-token';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { v4 as uuidv4 } from 'uuid';
import { UsersService } from '../users/users.service';
import { LevelsService } from '../levels/levels.service';
import { SettingsService } from '../settings/settings.service';
import { TransactionsService } from '../transactions/transactions.service';

@Injectable()
export class BroadcastsService implements OnModuleInit {
  private readonly logger = new Logger(BroadcastsService.name);

  public onZombieCleanup?: (broadcastIds: string[]) => void;
  public onBroadcastEnded?: (
    broadcastId: string,
    reason: string,
    broadcasterId?: string,
  ) => void;
  public onPkEnded?: (endResult: any) => void;

  constructor(
    @InjectModel(Broadcast.name) private broadcastModel: Model<Broadcast>,
    private configService: ConfigService,
    private usersService: UsersService,
    private levelsService: LevelsService,
    private settingsService: SettingsService,
    private transactionsService: TransactionsService,
  ) {}

  async onModuleInit() {
    const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000);
    await this.broadcastModel.updateMany(
      {
        status: 'disconnected',
        disconnectedAt: { $lt: threeMinutesAgo },
      },
      { status: 'ended', isLive: false },
    );

    // Auto-end any PK battles stuck in active/invited on server restart
    await this.broadcastModel.updateMany(
      { 'pk.status': { $in: ['active', 'invited'] } },
      {
        $set: {
          'pk.status': 'ended',
          'pk.result': 'draw',
          'pk.winnerId': null,
          'pk.endsAt': new Date(),
          'pk.inviteExpiresAt': null,
        },
      },
    );
  }

  async create(userId: string, dto: CreateBroadcastDto) {
    const existingLive = await this.broadcastModel.findOne({
      broadcaster: userId,
      isLive: true,
    });

    if (existingLive) {
      throw new ConflictException('You already have an active broadcast');
    }

    const channelName = uuidv4();
    const broadcast = new this.broadcastModel({
      ...dto,
      broadcaster: userId,
      channelName,
      isLive: true,
      lastHeartbeat: new Date(),
    });

    return broadcast.save();
  }

  async heartbeat(broadcastId: string, userId: string) {
    const broadcast = await this.broadcastModel.findById(broadcastId);
    if (!broadcast) {
      throw new ConflictException('Broadcast not found');
    }

    if (broadcast.broadcaster.toString() !== userId) {
      throw new ForbiddenException('Only the broadcaster can send a heartbeat');
    }

    if (!broadcast.isLive) {
      throw new ConflictException('Broadcast is not live');
    }

    broadcast.lastHeartbeat = new Date();
    await broadcast.save();
  }

  async endBroadcast(broadcastId: string, userId?: string) {
    const broadcast = await this.broadcastModel.findById(broadcastId);
    if (!broadcast) {
      throw new ConflictException('Broadcast not found');
    }

    if (userId && broadcast.broadcaster.toString() !== userId) {
      throw new ForbiddenException(
        'Only the broadcaster can end the broadcast',
      );
    }

    // If broadcast was in active PK, cleanly end it
    if (broadcast.pk?.status === 'active' && broadcast.pk?.opponentBroadcastId) {
      const oppId = broadcast.pk.opponentBroadcastId.toString();
      const bId = broadcast._id.toString();
      const broadcastIdA = broadcast.pk.pkRole === 'hostA' ? bId : oppId;
      const broadcastIdB = broadcast.pk.pkRole === 'hostA' ? oppId : bId;
      try {
        await this.endPk(broadcastIdA, broadcastIdB, 'broadcast_ended');
      } catch (pkErr) {
        this.logger.error(`Error ending PK during broadcast end: ${pkErr.message}`);
      }
    }

    broadcast.isLive = false;
    broadcast.status = 'ended';
    broadcast.endedAt = new Date();
    const saved = await broadcast.save();

    const broadcasterId =
      (broadcast.broadcaster as any)?._id?.toString() ||
      broadcast.broadcaster?.toString();
    const reason = userId ? 'broadcaster_ended' : 'admin_forced';

    if (this.onBroadcastEnded) {
      try {
        this.onBroadcastEnded(broadcastId, reason, broadcasterId);
      } catch (err) {
        this.logger.error(`Error in onBroadcastEnded callback: ${err.message}`);
      }
    }

    return saved;
  }

  async forceEndPk(broadcastId: string) {
    if (!Types.ObjectId.isValid(broadcastId)) {
      throw new BadRequestException('Invalid broadcast ID');
    }

    const broadcast = await this.broadcastModel.findById(broadcastId);
    if (!broadcast) {
      throw new NotFoundException('Broadcast not found');
    }

    if (broadcast.pk?.status !== 'active' || !broadcast.pk?.opponentBroadcastId) {
      throw new BadRequestException('Broadcast is not in an active PK battle');
    }

    const oppId = broadcast.pk.opponentBroadcastId.toString();
    const bId = broadcast._id.toString();
    const broadcastIdA = broadcast.pk.pkRole === 'hostA' ? bId : oppId;
    const broadcastIdB = broadcast.pk.pkRole === 'hostA' ? oppId : bId;

    return this.endPk(broadcastIdA, broadcastIdB, 'admin_forced');
  }

  async markDisconnected(broadcastId: string) {
    return this.broadcastModel.findByIdAndUpdate(broadcastId, {
      status: 'disconnected',
      disconnectedAt: new Date(),
    });
  }

  async updateStatus(
    broadcastId: string,
    status: 'live' | 'disconnected' | 'ended',
  ) {
    return this.broadcastModel.findByIdAndUpdate(broadcastId, { status });
  }

  async findActiveBroadcastForUser(userId: string) {
    return this.broadcastModel.findOne({
      broadcaster: userId,
      status: { $in: ['live', 'disconnected'] },
    });
  }

  generateAgoraToken(
    channelName: string,
    uid: number,
    role: 'publisher' | 'subscriber',
  ) {
    const appId = this.configService.get<string>('AGORA_APP_ID');
    const appCertificate = this.configService.get<string>(
      'AGORA_APP_CERTIFICATE',
    );

    if (!appId || !appCertificate) {
      throw new Error('Agora credentials are not configured');
    }

    const expireSeconds = 3600; // 1 hour from now

    const tokenRole =
      role === 'publisher' ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;

    return RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCertificate,
      channelName,
      uid,
      tokenRole,
      expireSeconds,
      expireSeconds,
    );
  }

  getAgoraAppId(): string {
    return this.configService.get<string>('AGORA_APP_ID') || '';
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async cleanupZombieBroadcasts() {
    const ninetySecondsAgo = new Date(Date.now() - 90 * 1000);

    const zombies = await this.broadcastModel.find({
      isLive: true,
      lastHeartbeat: { $lt: ninetySecondsAgo },
    });

    if (zombies.length > 0) {
      this.logger.log(`Cleaning up ${zombies.length} zombie broadcasts`);

      // Cleanly end PK battle for any zombie in active PK
      for (const zombie of zombies) {
        if (zombie.pk?.status === 'active' && zombie.pk?.opponentBroadcastId) {
          const opponentId = zombie.pk.opponentBroadcastId.toString();
          const zId = zombie._id.toString();
          const broadcastIdA = zombie.pk.pkRole === 'hostA' ? zId : opponentId;
          const broadcastIdB = zombie.pk.pkRole === 'hostA' ? opponentId : zId;
          try {
            await this.endPk(broadcastIdA, broadcastIdB, 'broadcast_ended');
          } catch (pkErr) {
            this.logger.error(`Error ending PK for zombie broadcast: ${pkErr.message}`);
          }
        }
      }

      const bulkOps = zombies.map((zombie) => ({
        updateOne: {
          filter: { _id: zombie._id },
          update: {
            $set: {
              isLive: false,
              status: 'ended',
              endedAt: new Date(),
              'pk.status': 'ended',
              'pk.result': 'draw',
              'pk.endsAt': new Date(),
            },
          },
        },
      }));

      await this.broadcastModel.bulkWrite(bulkOps);

      if (this.onZombieCleanup) {
        this.onZombieCleanup(zombies.map((z) => z._id.toString()));
      }
    }
  }

  @Cron('*/5 * * * * *')
  async autoEndExpiredPkBattles() {
    const now = new Date();
    const expiredBroadcasts = await this.broadcastModel.find({
      'pk.status': 'active',
      'pk.endsAt': { $lte: now },
    });

    if (!expiredBroadcasts || expiredBroadcasts.length === 0) return;

    const processedPairs = new Set<string>();

    for (const b of expiredBroadcasts) {
      const bId = b._id.toString();
      const oppId = b.pk?.opponentBroadcastId?.toString();
      if (!oppId) continue;

      const pairKey = [bId, oppId].sort().join('_');
      if (processedPairs.has(pairKey)) continue;
      processedPairs.add(pairKey);

      try {
        const broadcastIdA = b.pk?.pkRole === 'hostA' ? bId : oppId;
        const broadcastIdB = b.pk?.pkRole === 'hostA' ? oppId : bId;
        await this.endPk(broadcastIdA, broadcastIdB, 'time_up');
      } catch (err) {
        this.logger.error(`Error in autoEndExpiredPkBattles for pair ${pairKey}: ${err.message}`);
      }
    }
  }

  async findAll(
    status?: string,
    category?: string,
    broadcasterId?: string,
    cursor?: string,
    limit: number = 20,
  ) {
    const query: any = {};

    if (status === 'live') {
      query.isLive = true;
      query.status = { $ne: 'ended' };
    } else if (status === 'ended') {
      query.isLive = false;
    }

    if (category && category !== 'All') {
      query.category = category;
    }

    if (broadcasterId) {
      query.broadcaster = broadcasterId;
    }

    if (cursor) {
      // Decode cursor assuming it's the startedAt date or _id
      // We will use _id for simplicity here. In a real app, cursor pagination on a sorted field is better.
      query._id = { $lt: cursor };
    }

    const items = await this.broadcastModel
      .find(query)
      .sort({ startedAt: -1, _id: -1 })
      .limit(limit + 1)
      .populate('broadcaster', 'username displayName avatarUrl')
      .exec();

    const hasMore = items.length > limit;
    if (hasMore) {
      items.pop();
    }

    return {
      data: items,
      nextCursor: hasMore ? items[items.length - 1]._id.toString() : null,
      hasMore,
    };
  }

  async findById(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid broadcast ID');
    }
    return this.broadcastModel
      .findById(id)
      .populate('broadcaster', 'username displayName avatarUrl bio')
      .populate('pk.opponentUserId', 'username displayName avatarUrl bio')
      .populate('pk.opponentBroadcastId', 'title channelName thumbnailUrl isLive')
      .exec();
  }

  async search(q: string, cursor?: string, limit: number = 20) {
    const query: any = {};
    if (q) {
      query.$text = { $search: q };
    }

    if (cursor) {
      query._id = { $lt: cursor };
    }

    const items = await this.broadcastModel
      .find(query)
      .sort({ startedAt: -1, _id: -1 })
      .limit(limit + 1)
      .populate('broadcaster', 'username displayName avatarUrl')
      .exec();

    const hasMore = items.length > limit;
    if (hasMore) {
      items.pop();
    }

    return {
      data: items,
      nextCursor: hasMore ? items[items.length - 1]._id.toString() : null,
      hasMore,
    };
  }

  async findAllForAdmin(
    page: number = 1,
    limit: number = 20,
    search?: string,
  ): Promise<{ data: Broadcast[]; total: number }> {
    const skip = (page - 1) * limit;
    const query: any = {};

    if (search) {
      query.$text = { $search: search };
    }

    const [data, total] = await Promise.all([
      this.broadcastModel
        .find(query)
        .sort({ startedAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .populate('broadcaster', 'username displayName avatarUrl')
        .exec(),
      this.broadcastModel.countDocuments(query).exec(),
    ]);

    return { data, total };
  }

  // ==========================================
  //               PK BATTLE METHODS
  // ==========================================

  async invitePk(broadcastIdA: string, broadcastIdB: string, userAId: string) {
    if (!Types.ObjectId.isValid(broadcastIdA) || !Types.ObjectId.isValid(broadcastIdB)) {
      throw new BadRequestException('Invalid broadcast ID');
    }
    if (broadcastIdA === broadcastIdB) {
      throw new BadRequestException('Cannot challenge your own broadcast');
    }

    const [broadcastA, broadcastB] = await Promise.all([
      this.broadcastModel.findById(broadcastIdA).populate('broadcaster', 'username displayName avatarUrl'),
      this.broadcastModel.findById(broadcastIdB).populate('broadcaster', 'username displayName avatarUrl'),
    ]);

    if (!broadcastA || !broadcastA.isLive) {
      throw new NotFoundException('Your broadcast is not active');
    }
    if (!broadcastB || !broadcastB.isLive) {
      throw new NotFoundException('Opponent broadcast is not active');
    }

    const broadcasterAId = (broadcastA.broadcaster as any)._id?.toString() || broadcastA.broadcaster?.toString();
    if (broadcasterAId !== userAId) {
      throw new ForbiddenException('Only the broadcaster can initiate a PK battle');
    }

    // Prevent inviting if either challenger or opponent is already in an active PK battle
    if (broadcastA.pk?.status === 'active') {
      throw new ConflictException('You are already in an active PK battle');
    }
    if (broadcastB.pk?.status === 'active') {
      throw new ConflictException('Opponent is already in an active PK battle');
    }

    const broadcasterBId = (broadcastB.broadcaster as any)._id?.toString() || broadcastB.broadcaster?.toString();
    const expiresAt = new Date(Date.now() + 30 * 1000); // 30 seconds invitation expiry

    broadcastA.pk = {
      status: 'invited',
      pkRole: 'hostA',
      opponentBroadcastId: broadcastB._id,
      opponentUserId: broadcasterBId as any,
      startedAt: null,
      endsAt: null,
      durationSeconds: 600,
      scores: { hostA: 0, hostB: 0 },
      winnerId: null,
      result: null,
      inviteExpiresAt: expiresAt,
      topGifters: [],
    };

    broadcastB.pk = {
      status: 'invited',
      pkRole: 'hostB',
      opponentBroadcastId: broadcastA._id,
      opponentUserId: broadcasterAId as any,
      startedAt: null,
      endsAt: null,
      durationSeconds: 600,
      scores: { hostA: 0, hostB: 0 },
      winnerId: null,
      result: null,
      inviteExpiresAt: expiresAt,
      topGifters: [],
    };

    await Promise.all([broadcastA.save(), broadcastB.save()]);

    return { broadcastA, broadcastB };
  }

  async acceptPk(broadcastIdB: string, userBId: string) {
    if (!Types.ObjectId.isValid(broadcastIdB)) {
      throw new BadRequestException('Invalid broadcast ID');
    }

    const broadcastB = await this.broadcastModel.findById(broadcastIdB).populate('broadcaster', 'username displayName avatarUrl');
    if (!broadcastB || !broadcastB.isLive) {
      throw new NotFoundException('Broadcast is not active');
    }

    const broadcasterBId = (broadcastB.broadcaster as any)._id?.toString() || broadcastB.broadcaster?.toString();
    if (broadcasterBId !== userBId) {
      throw new ForbiddenException('Only the broadcaster can accept a PK battle');
    }

    if (broadcastB.pk?.status !== 'invited') {
      throw new ConflictException('No pending invitation to accept or already accepted');
    }

    const broadcastIdA = broadcastB.pk?.opponentBroadcastId?.toString();
    if (!broadcastIdA || !Types.ObjectId.isValid(broadcastIdA)) {
      throw new BadRequestException('No pending PK invitation found');
    }

    // Enforce invite expiry (BUG 5 Fix)
    if (broadcastB.pk?.inviteExpiresAt && new Date() > new Date(broadcastB.pk.inviteExpiresAt)) {
      broadcastB.pk.status = 'idle';
      broadcastB.pk.opponentBroadcastId = null;
      broadcastB.pk.opponentUserId = null;
      broadcastB.pk.inviteExpiresAt = null;
      await broadcastB.save();

      await this.broadcastModel.findByIdAndUpdate(broadcastIdA, {
        $set: {
          'pk.status': 'idle',
          'pk.opponentBroadcastId': null,
          'pk.opponentUserId': null,
          'pk.inviteExpiresAt': null,
        },
      });

      throw new BadRequestException('PK invitation has expired');
    }

    const broadcastA = await this.broadcastModel.findById(broadcastIdA).populate('broadcaster', 'username displayName avatarUrl');
    if (!broadcastA || !broadcastA.isLive) {
      throw new NotFoundException('Challenger broadcast is no longer active');
    }

    const broadcasterAId = (broadcastA.broadcaster as any)._id?.toString() || broadcastA.broadcaster?.toString();

    // Dynamic duration from settings (default 600s / 10 minutes)
    let DURATION_SECONDS = 600;
    try {
      const s = await this.settingsService.findByKey('pk_duration_seconds');
      if (s && typeof s.value === 'number' && s.value > 0) DURATION_SECONDS = s.value;
    } catch {}
    const startedAt = new Date();
    const endsAt = new Date(startedAt.getTime() + DURATION_SECONDS * 1000);

    // Atomic guard: verify and update status from 'invited' to 'active' in one atomic operation (BUG 4 Fix)
    const updatedB = await this.broadcastModel
      .findOneAndUpdate(
        { _id: broadcastB._id, 'pk.status': 'invited' },
        {
          $set: {
            'pk.status': 'active',
            'pk.pkRole': 'hostB',
            'pk.opponentBroadcastId': broadcastA._id,
            'pk.opponentUserId': broadcasterAId,
            'pk.startedAt': startedAt,
            'pk.endsAt': endsAt,
            'pk.durationSeconds': DURATION_SECONDS,
            'pk.scores': { hostA: 0, hostB: 0 },
            'pk.winnerId': null,
            'pk.result': null,
            'pk.inviteExpiresAt': null,
            'pk.topGifters': [],
          },
        },
        { returnDocument: 'after' },
      )
      .populate('broadcaster', 'username displayName avatarUrl');

    if (!updatedB) {
      throw new ConflictException('PK invitation already accepted or no longer valid');
    }

    const updatedA = await this.broadcastModel
      .findOneAndUpdate(
        { _id: broadcastA._id, 'pk.status': 'invited' },
        {
          $set: {
            'pk.status': 'active',
            'pk.pkRole': 'hostA',
            'pk.opponentBroadcastId': broadcastB._id,
            'pk.opponentUserId': broadcasterBId,
            'pk.startedAt': startedAt,
            'pk.endsAt': endsAt,
            'pk.durationSeconds': DURATION_SECONDS,
            'pk.scores': { hostA: 0, hostB: 0 },
            'pk.winnerId': null,
            'pk.result': null,
            'pk.inviteExpiresAt': null,
            'pk.topGifters': [],
          },
        },
        { returnDocument: 'after' },
      )
      .populate('broadcaster', 'username displayName avatarUrl');

    if (!updatedA) {
      // Rollback B if A could not be atomically updated to active
      await this.broadcastModel.findByIdAndUpdate(broadcastB._id, {
        $set: {
          'pk.status': 'idle',
          'pk.pkRole': null,
          'pk.opponentBroadcastId': null,
          'pk.opponentUserId': null,
          'pk.inviteExpiresAt': null,
          'pk.topGifters': [],
        },
      });
      throw new ConflictException('Challenger broadcast is no longer in valid invited state');
    }

    return {
      broadcastA: updatedA,
      broadcastB: updatedB,
      startedAt,
      endsAt,
      durationSeconds: DURATION_SECONDS,
    };
  }

  async declinePk(broadcastIdB: string, userBId: string) {
    if (!Types.ObjectId.isValid(broadcastIdB)) {
      throw new BadRequestException('Invalid broadcast ID');
    }

    const broadcastB = await this.broadcastModel.findById(broadcastIdB);
    if (!broadcastB) return null;

    // Authorization: only the broadcaster can decline (BUG 6)
    const broadcasterBId =
      (broadcastB.broadcaster as any)?._id?.toString() ||
      broadcastB.broadcaster?.toString();

    if (broadcasterBId !== userBId) {
      throw new ForbiddenException('Only the broadcaster can decline a PK battle');
    }

    // Status guard: only pending invitations can be declined
    if (broadcastB.pk?.status !== 'invited') {
      throw new BadRequestException('No pending invitation to decline');
    }

    const opponentBroadcastId = broadcastB.pk?.opponentBroadcastId?.toString();
    const opponentBroadcasterId = broadcastB.pk?.opponentUserId?.toString();

    broadcastB.pk = {
      status: 'idle',
      pkRole: null,
      opponentBroadcastId: null,
      opponentUserId: null,
      startedAt: null,
      endsAt: null,
      durationSeconds: 600,
      scores: { hostA: 0, hostB: 0 },
      winnerId: null,
      result: null,
      inviteExpiresAt: null,
      topGifters: [],
    };
    await broadcastB.save();

    if (opponentBroadcastId && Types.ObjectId.isValid(opponentBroadcastId)) {
      await this.broadcastModel.findByIdAndUpdate(opponentBroadcastId, {
        $set: {
          'pk.status': 'idle',
          'pk.pkRole': null,
          'pk.opponentBroadcastId': null,
          'pk.opponentUserId': null,
          'pk.inviteExpiresAt': null,
          'pk.topGifters': [],
        },
      });
    }

    return {
      broadcastIdB,
      opponentBroadcastId,
      opponentBroadcasterId,
    };
  }

  async incrementPkScore(broadcastId: string, side: 'hostA' | 'hostB', amount: number) {
    if (!Types.ObjectId.isValid(broadcastId)) return null;

    const broadcast = await this.broadcastModel.findById(broadcastId);
    if (!broadcast || broadcast.pk?.status !== 'active') return null;

    const opponentBroadcastId = broadcast.pk.opponentBroadcastId?.toString();
    const update = { $inc: { [`pk.scores.${side}`]: amount } };

    // Atomically update both broadcast documents and return fresh scores
    const [updatedBroadcast] = await Promise.all([
      this.broadcastModel.findByIdAndUpdate(broadcastId, update, { returnDocument: 'after' }),
      opponentBroadcastId && Types.ObjectId.isValid(opponentBroadcastId)
        ? this.broadcastModel.findByIdAndUpdate(opponentBroadcastId, update, { returnDocument: 'after' })
        : Promise.resolve(null),
    ]);

    return updatedBroadcast?.pk?.scores || { hostA: 0, hostB: 0 };
  }

  async recordPkGift(
    broadcastId: string,
    user: {
      userId: string;
      username?: string;
      displayName?: string;
      avatarUrl?: string;
    },
    amount: number,
  ) {
    if (!Types.ObjectId.isValid(broadcastId)) return null;

    const broadcast = await this.broadcastModel.findById(broadcastId);
    if (!broadcast || broadcast.pk?.status !== 'active') return null;

    const side = broadcast.pk.pkRole || 'hostA';
    const opponentBroadcastId = broadcast.pk.opponentBroadcastId?.toString();

    if (!opponentBroadcastId || !Types.ObjectId.isValid(opponentBroadcastId)) {
      return null;
    }

    const broadcastIdA = side === 'hostA' ? broadcastId : opponentBroadcastId;
    const broadcastIdB = side === 'hostB' ? broadcastId : opponentBroadcastId;

    const ids = [new Types.ObjectId(broadcastId), new Types.ObjectId(opponentBroadcastId)];
    const userObjId = Types.ObjectId.isValid(user.userId) ? new Types.ObjectId(user.userId) : null;

    // 1. Try to increment score and gifter coins atomically if user is already in topGifters
    let updated = false;
    if (userObjId) {
      const updateResult = await this.broadcastModel.updateMany(
        {
          _id: { $in: ids },
          'pk.status': 'active',
          'pk.topGifters.userId': userObjId,
        },
        {
          $inc: {
            [`pk.scores.${side}`]: amount,
            'pk.topGifters.$.totalCoins': amount,
          },
          $set: {
            'pk.topGifters.$.username': user.username || '',
            'pk.topGifters.$.displayName': user.displayName || user.username || 'Fan',
            'pk.topGifters.$.avatarUrl': user.avatarUrl || '',
          },
        },
      );
      if (updateResult.matchedCount > 0) {
        updated = true;
      }
    }

    // 2. If user is not yet in topGifters array, push them and increment score
    if (!updated) {
      const newGifter = {
        userId: userObjId || user.userId,
        username: user.username || '',
        displayName: user.displayName || user.username || 'Fan',
        avatarUrl: user.avatarUrl || '',
        totalCoins: amount,
        side,
      };

      await this.broadcastModel.updateMany(
        {
          _id: { $in: ids },
          'pk.status': 'active',
        },
        {
          $inc: {
            [`pk.scores.${side}`]: amount,
          },
          $push: {
            'pk.topGifters': newGifter,
          },
        },
      );
    }

    // 3. Fetch the fresh document to return current scores and top 3 gifters per side
    const freshDoc = await this.broadcastModel.findById(broadcastId);
    if (!freshDoc || !freshDoc.pk) return null;

    const scores = freshDoc.pk.scores || { hostA: 0, hostB: 0 };
    const giftersList = freshDoc.pk.topGifters || [];

    const giftersMapA = new Map<string, any>();
    const giftersMapB = new Map<string, any>();

    for (const g of giftersList) {
      const key = (g.userId?.toString() || g.username || '').toLowerCase();
      if (!key) continue;
      const targetMap = g.side === 'hostA' ? giftersMapA : giftersMapB;
      const item = (g as any).toObject ? (g as any).toObject() : { ...g };
      if (targetMap.has(key)) {
        targetMap.get(key).totalCoins += item.totalCoins;
      } else {
        targetMap.set(key, item);
      }
    }

    const topA = Array.from(giftersMapA.values())
      .sort((a, b) => b.totalCoins - a.totalCoins)
      .slice(0, 3);
    const topB = Array.from(giftersMapB.values())
      .sort((a, b) => b.totalCoins - a.totalCoins)
      .slice(0, 3);

    return {
      broadcastIdA,
      broadcastIdB,
      side,
      scores,
      topGifters: { hostA: topA, hostB: topB },
    };
  }

  async endPk(
    broadcastIdA: string,
    broadcastIdB: string,
    reason: string = 'time_up',
    rawTopGifters: any[] = [],
  ) {
    if (!Types.ObjectId.isValid(broadcastIdA) || !Types.ObjectId.isValid(broadcastIdB)) {
      throw new BadRequestException('Invalid broadcast ID');
    }

    const [broadcastA, broadcastB] = await Promise.all([
      this.broadcastModel.findById(broadcastIdA).populate('broadcaster', 'username displayName avatarUrl'),
      this.broadcastModel.findById(broadcastIdB).populate('broadcaster', 'username displayName avatarUrl'),
    ]);

    if (!broadcastA || !broadcastB) return null;
    if (broadcastA.pk?.status !== 'active' && broadcastB.pk?.status !== 'active') {
      return null;
    }

    // Unified score check across documents (BUG 2 Fix)
    const scoreA = broadcastA.pk?.scores?.hostA ?? broadcastB.pk?.scores?.hostA ?? 0;
    const scoreB = broadcastA.pk?.scores?.hostB ?? broadcastB.pk?.scores?.hostB ?? 0;

    const userA = broadcastA.broadcaster as any;
    const userB = broadcastB.broadcaster as any;
    const userAId = userA?._id?.toString() || broadcastA.broadcaster?.toString();
    const userBId = userB?._id?.toString() || broadcastB.broadcaster?.toString();

    let winnerId: string | null = null;
    let loserId: string | null = null;
    let winnerScore = 0;
    let result: 'hostA' | 'hostB' | 'draw' = 'draw';

    if (scoreA > scoreB) {
      winnerId = userAId;
      loserId = userBId;
      winnerScore = scoreA;
      result = 'hostA';
    } else if (scoreB > scoreA) {
      winnerId = userBId;
      loserId = userAId;
      winnerScore = scoreB;
      result = 'hostB';
    }

    // Fetch dynamic economy settings
    let victoryBonusPercent = 20;
    try {
      const s = await this.settingsService.findByKey('pk_victory_bonus_percent');
      if (s && typeof s.value === 'number') victoryBonusPercent = s.value;
    } catch {}

    let mvpXpBonus = 50;
    try {
      const s = await this.settingsService.findByKey('pk_mvp_xp_bonus');
      if (s && typeof s.value === 'number') mvpXpBonus = s.value;
    } catch {}

    let streakRewards: Array<{ streak: number; diamonds: number; xp: number; badge?: string | null; label: string }> = [
      { streak: 3, diamonds: 50, xp: 100, badge: null, label: 'Hat-trick 🎩' },
      { streak: 5, diamonds: 150, xp: 250, badge: null, label: 'On Fire 🔥' },
      { streak: 10, diamonds: 500, xp: 500, badge: 'pk_legend', label: 'PK Legend 👑' },
    ];
    try {
      const s = await this.settingsService.findByKey('pk_streak_rewards');
      if (s && Array.isArray(s.value)) streakRewards = s.value;
    } catch {}

    let bonusDiamonds = 0;
    let streakMilestone: any = null;
    let winnerNewStreak = 0;

    if (winnerId && result !== 'draw') {
      // 1. Victory Bonus Diamonds
      if (winnerScore > 0 && victoryBonusPercent > 0) {
        bonusDiamonds = Math.floor((winnerScore * victoryBonusPercent) / 100);
        if (bonusDiamonds > 0) {
          await this.usersService.addDiamonds(winnerId, bonusDiamonds);
          try {
            await this.transactionsService.create({
              user: winnerId,
              amount: bonusDiamonds,
              type: 'gift_received',
              description: `PK Battle Victory Bonus (+${victoryBonusPercent}%)`,
              status: 'completed',
            });
          } catch (tErr) {
            this.logger.warn(`Failed to log PK victory bonus transaction: ${tErr.message}`);
          }
        }
      }

      // 2. Win Streak & Stats
      const winnerDoc = await this.usersService.findById(winnerId);
      const currentStreak = winnerDoc?.pkWinStreak || 0;
      winnerNewStreak = currentStreak + 1;
      const bestStreak = Math.max(winnerDoc?.pkBestStreak || 0, winnerNewStreak);

      await this.usersService.updatePkStats(winnerId, {
        result: 'win',
        newStreak: winnerNewStreak,
        bestStreak,
      });

      // 3. Reset Loser's Win Streak
      if (loserId) {
        await this.usersService.updatePkStats(loserId, {
          result: 'loss',
        });
      }

      // 4. Check Streak Milestones & Award Rewards
      const milestone = streakRewards.find((m) => m.streak === winnerNewStreak);
      if (milestone) {
        streakMilestone = milestone;
        if (milestone.diamonds > 0) {
          await this.usersService.addDiamonds(winnerId, milestone.diamonds);
        }
        if (milestone.xp > 0) {
          await this.levelsService.processXPGain(winnerId, milestone.xp, 'pk_streak_reward');
        }
        if (milestone.badge) {
          await this.usersService.addInventoryItem(winnerId, {
            itemId: milestone.badge,
            name: milestone.label,
            type: 'badge',
            source: 'pk_streak',
          });
        }
      }
    } else if (result === 'draw') {
      // Update draw count for both broadcasters
      if (userAId) await this.usersService.updatePkStats(userAId, { result: 'draw' });
      if (userBId) await this.usersService.updatePkStats(userBId, { result: 'draw' });
    }

    // Format topGifters list - fallback to DB-stored topGifters if rawTopGifters is empty
    let giftersToProcess = rawTopGifters;
    if (!Array.isArray(giftersToProcess) || giftersToProcess.length === 0) {
      giftersToProcess = broadcastA.pk?.topGifters || broadcastB.pk?.topGifters || [];
    }

    const formattedTopGifters: any[] = [];
    if (Array.isArray(giftersToProcess)) {
      for (const g of giftersToProcess) {
        if (g && (g.userId || g.username)) {
          formattedTopGifters.push({
            userId: g.userId,
            username: g.username || '',
            displayName: g.displayName || g.username || 'Fan',
            avatarUrl: g.avatarUrl || '',
            totalCoins: g.totalCoins || 0,
            side: g.side,
          });
        }
      }
    }

    // Award MVP XP to the top contributor on each side
    if (mvpXpBonus > 0 && formattedTopGifters.length > 0) {
      const topHostA = formattedTopGifters
        .filter((g) => g.side === 'hostA')
        .sort((a, b) => b.totalCoins - a.totalCoins)[0];
      const topHostB = formattedTopGifters
        .filter((g) => g.side === 'hostB')
        .sort((a, b) => b.totalCoins - a.totalCoins)[0];

      if (topHostA?.userId && Types.ObjectId.isValid(topHostA.userId)) {
        await this.levelsService.processXPGain(topHostA.userId, mvpXpBonus, 'pk_mvp_bonus');
      }
      if (topHostB?.userId && Types.ObjectId.isValid(topHostB.userId)) {
        await this.levelsService.processXPGain(topHostB.userId, mvpXpBonus, 'pk_mvp_bonus');
      }
    }

    const endUpdate = {
      'pk.status': 'ended',
      'pk.winnerId': winnerId,
      'pk.result': result,
      'pk.endsAt': new Date(),
      'pk.topGifters': formattedTopGifters,
    };

    await Promise.all([
      this.broadcastModel.findByIdAndUpdate(broadcastIdA, { $set: endUpdate }),
      this.broadcastModel.findByIdAndUpdate(broadcastIdB, { $set: endUpdate }),
    ]);

    const endResult = {
      broadcastIdA,
      broadcastIdB,
      scores: { hostA: scoreA, hostB: scoreB },
      winnerId: winnerId ? winnerId.toString() : null,
      result,
      reason,
      hostAUser: userA,
      hostBUser: userB,
      bonusDiamonds,
      streakMilestone,
      winnerNewStreak,
      topGifters: formattedTopGifters,
    };

    if (this.onPkEnded) {
      try {
        this.onPkEnded(endResult);
      } catch (cbErr) {
        this.logger.error(`Error in onPkEnded callback: ${cbErr.message}`);
      }
    }

    return endResult;
  }

  async getActivePkBroadcasts() {
    return this.broadcastModel
      .find({
        isLive: true,
        'pk.status': 'active',
      })
      .populate('broadcaster', 'username displayName avatarUrl')
      .populate('pk.opponentUserId', 'username displayName avatarUrl')
      .populate('pk.opponentBroadcastId', 'title channelName thumbnailUrl isLive')
      .exec();
  }

  async getPkStatus(broadcastId: string) {
    if (!Types.ObjectId.isValid(broadcastId)) {
      throw new BadRequestException('Invalid broadcast ID');
    }
    const broadcast = await this.broadcastModel
      .findById(broadcastId)
      .populate('broadcaster', 'username displayName avatarUrl')
      .populate('pk.opponentUserId', 'username displayName avatarUrl')
      .populate('pk.opponentBroadcastId', 'title channelName thumbnailUrl isLive')
      .exec();

    if (!broadcast) throw new NotFoundException('Broadcast not found');
    return {
      broadcastId: broadcast._id,
      pk: broadcast.pk,
    };
  }
}

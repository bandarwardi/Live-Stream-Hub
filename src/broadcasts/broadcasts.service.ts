import {
  Injectable,
  ConflictException,
  ForbiddenException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Broadcast } from './schemas/broadcast.schema';
import { CreateBroadcastDto } from './dto/create-broadcast.dto';
import { RtcTokenBuilder, RtcRole } from 'agora-token';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class BroadcastsService implements OnModuleInit {
  private readonly logger = new Logger(BroadcastsService.name);

  public onZombieCleanup?: (broadcastIds: string[]) => void;

  constructor(
    @InjectModel(Broadcast.name) private broadcastModel: Model<Broadcast>,
    private configService: ConfigService,
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

    broadcast.isLive = false;
    broadcast.status = 'ended';
    broadcast.endedAt = new Date();
    return broadcast.save();
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

      const bulkOps = zombies.map((zombie) => ({
        updateOne: {
          filter: { _id: zombie._id },
          update: {
            $set: {
              isLive: false,
              status: 'ended',
              endedAt: new Date(),
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
    return this.broadcastModel
      .findById(id)
      .populate('broadcaster', 'username displayName avatarUrl bio')
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
}

import { Injectable, ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Broadcast } from './schemas/broadcast.schema';
import { CreateBroadcastDto } from './dto/create-broadcast.dto';
import { RtcTokenBuilder, RtcRole } from 'agora-token';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class BroadcastsService {
  private readonly logger = new Logger(BroadcastsService.name);

  constructor(
    @InjectModel(Broadcast.name) private broadcastModel: Model<Broadcast>,
    private configService: ConfigService,
  ) {}

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

  async endBroadcast(broadcastId: string, userId: string) {
    const broadcast = await this.broadcastModel.findById(broadcastId);
    if (!broadcast) {
      throw new ConflictException('Broadcast not found');
    }

    if (broadcast.broadcaster.toString() !== userId) {
      throw new ForbiddenException('Only the broadcaster can end the broadcast');
    }

    broadcast.isLive = false;
    broadcast.endedAt = new Date();
    return broadcast.save();
  }

  generateAgoraToken(channelName: string, uid: number, role: 'publisher' | 'subscriber') {
    const appId = this.configService.get<string>('AGORA_APP_ID');
    const appCertificate = this.configService.get<string>('AGORA_APP_CERTIFICATE');
    
    if (!appId || !appCertificate) {
      throw new Error('Agora credentials are not configured');
    }

    const expirationTimeInSeconds = 3600; // 1 hour
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

    const tokenRole = role === 'publisher' ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;

    return RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCertificate,
      channelName,
      uid,
      tokenRole,
      expirationTimeInSeconds,
      privilegeExpiredTs
    );
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
      
      const bulkOps = zombies.map(zombie => ({
        updateOne: {
          filter: { _id: zombie._id },
          update: {
            $set: {
              isLive: false,
              endedAt: new Date(),
            },
          },
        }
      }));

      await this.broadcastModel.bulkWrite(bulkOps);
    }
  }

  async findAll(status?: string, category?: string, cursor?: string, limit: number = 20) {
    const query: any = {};
    
    if (status === 'live') {
      query.isLive = true;
    } else if (status === 'ended') {
      query.isLive = false;
    }
    
    if (category && category !== 'All') {
      query.category = category;
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
}

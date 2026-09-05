import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RtcTokenBuilder, RtcRole } from 'agora-token';
import { VoiceRoom } from './schemas/voice-room.schema';
import { SeatRequest } from './schemas/seat-request.schema';
import { CreateVoiceRoomDto } from './dto/create-voice-room.dto';
import { UsersService } from '../users/users.service';

@Injectable()
export class VoiceRoomsService {
  private readonly logger = new Logger(VoiceRoomsService.name);

  // Callbacks for ChatGateway notifications
  public onVoiceRoomEnded?: (
    roomId: string,
    reason: string,
    hostId?: string,
  ) => void;
  public onSeatsUpdated?: (roomId: string, seats: any[]) => void;
  public onZombieCleanup?: (roomIds: string[]) => void;

  constructor(
    @InjectModel(VoiceRoom.name)
    private readonly voiceRoomModel: Model<VoiceRoom>,
    @InjectModel(SeatRequest.name)
    private readonly seatRequestModel: Model<SeatRequest>,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {}

  async create(userId: string, dto: CreateVoiceRoomDto): Promise<VoiceRoom> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // End any previous active voice rooms for this host
    const existing = await this.voiceRoomModel.find({
      host: userId,
      status: { $in: ['live', 'disconnected'] },
    });
    for (const room of existing) {
      await this.endRoom(room._id.toString(), userId, 'replaced_by_new');
    }

    const channelName = `voice_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const guestSeatCount = dto.maxSeats || 8; // 4, 8, or 12

    // Initialize seat array: Seat 0 is host, 1..guestSeatCount are guest seats
    const seats: any[] = [];
    // Host seat 0
    seats.push({
      index: 0,
      userId: user._id.toString(),
      displayName: user.displayName || user.username,
      username: user.username,
      avatarUrl: user.avatarUrl || null,
      isMuted: false,
      isLocked: false,
    });

    // Guest seats 1..guestSeatCount
    for (let i = 1; i <= guestSeatCount; i++) {
      seats.push({
        index: i,
        userId: null,
        displayName: null,
        username: null,
        avatarUrl: null,
        isMuted: false,
        isLocked: false,
      });
    }

    const room = new this.voiceRoomModel({
      title: dto.title,
      host: userId,
      channelName,
      category: dto.category || 'ChitChat',
      coverUrl: dto.coverUrl || user.avatarUrl || null,
      maxSeats: guestSeatCount,
      seats,
      description: dto.description || '',
      isLive: true,
      status: 'live',
      startedAt: new Date(),
      lastHeartbeat: new Date(),
    });

    return (await room.save()).populate('host', 'displayName username avatarUrl currentLevel levelBadgeUrl');
  }

  async findAllLive(
    page = 1,
    limit = 20,
    sortBy: 'viewers' | 'gifts' | 'newest' = 'viewers',
    category?: string,
  ): Promise<{ data: VoiceRoom[]; total: number }> {
    const skip = (page - 1) * limit;
    const filter: any = { isLive: true, status: 'live' };

    if (category && category !== 'All') {
      filter.category = category;
    }

    let sort: any = { viewerCount: -1, startedAt: -1 };
    if (sortBy === 'gifts') {
      sort = { totalGiftsReceived: -1, startedAt: -1 };
    } else if (sortBy === 'newest') {
      sort = { startedAt: -1 };
    }

    const [data, total] = await Promise.all([
      this.voiceRoomModel
        .find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .populate('host', 'displayName username avatarUrl currentLevel levelBadgeUrl')
        .exec(),
      this.voiceRoomModel.countDocuments(filter).exec(),
    ]);

    return { data, total };
  }

  async findById(id: string): Promise<VoiceRoom> {
    const room = await this.voiceRoomModel
      .findById(id)
      .populate('host', 'displayName username avatarUrl currentLevel levelBadgeUrl')
      .exec();

    if (!room) {
      throw new NotFoundException('Voice room not found');
    }
    return room;
  }

  async findActiveRoomForUser(userId: string): Promise<VoiceRoom | null> {
    return this.voiceRoomModel.findOne({
      host: userId,
      status: { $in: ['live', 'disconnected'] },
    });
  }

  async endRoom(roomId: string, userId?: string, reason = 'ended'): Promise<VoiceRoom> {
    const room = await this.voiceRoomModel.findById(roomId);
    if (!room) {
      throw new NotFoundException('Voice room not found');
    }

    if (userId && room.host.toString() !== userId) {
      throw new ForbiddenException('Only the host can end the voice room');
    }

    room.isLive = false;
    room.status = 'ended';
    room.endedAt = new Date();
    const saved = await room.save();

    // Cancel all pending requests
    await this.seatRequestModel.updateMany(
      { roomId, status: 'pending' },
      { status: 'cancelled' },
    );

    const hostId = (room.host as any)?._id?.toString() || room.host?.toString();
    if (this.onVoiceRoomEnded) {
      try {
        this.onVoiceRoomEnded(roomId, reason, hostId);
      } catch (err) {
        this.logger.error(`Error in onVoiceRoomEnded: ${err.message}`);
      }
    }

    return saved;
  }

  async heartbeat(roomId: string, userId: string): Promise<void> {
    await this.voiceRoomModel.updateOne(
      { _id: roomId, host: userId, isLive: true },
      { lastHeartbeat: new Date() },
    );
  }

  async markDisconnected(roomId: string): Promise<void> {
    await this.voiceRoomModel.findByIdAndUpdate(roomId, {
      status: 'disconnected',
      disconnectedAt: new Date(),
    });
  }

  async updateStatus(
    roomId: string,
    status: 'live' | 'disconnected' | 'ended',
  ): Promise<void> {
    await this.voiceRoomModel.findByIdAndUpdate(roomId, { status });
  }

  async updateViewerCount(roomId: string, count: number): Promise<void> {
    const room = await this.voiceRoomModel.findById(roomId);
    if (!room) return;

    room.viewerCount = count;
    if (count > (room.peakViewerCount || 0)) {
      room.peakViewerCount = count;
    }
    await room.save();
  }

  // --- SEAT MANAGEMENT ---

  async takeSeat(
    roomId: string,
    seatIndex: number,
    userData: {
      userId: string;
      displayName: string;
      username: string;
      avatarUrl?: string;
    },
  ): Promise<any[]> {
    const room = await this.voiceRoomModel.findById(roomId);
    if (!room || !room.isLive) {
      throw new NotFoundException('Voice room is not active');
    }

    if (seatIndex < 0 || seatIndex >= room.seats.length) {
      throw new ForbiddenException('Invalid seat index');
    }

    const hostId =
      (room.host as any)?._id?.toString() || room.host?.toString();
    if (seatIndex === 0 && hostId !== userData.userId) {
      throw new ForbiddenException('Seat 0 is reserved for the room host');
    }

    const seat = room.seats.find((s) => s.index === seatIndex);
    if (!seat) {
      throw new NotFoundException('Seat not found');
    }

    if (seat.isLocked) {
      throw new ForbiddenException('This seat is locked');
    }

    if (seat.userId && seat.userId.toString() !== userData.userId) {
      throw new ForbiddenException('Seat is already occupied');
    }

    // Remove user from any other seat in this room first
    room.seats.forEach((s) => {
      if (s.userId && s.userId.toString() === userData.userId) {
        s.userId = null;
        s.displayName = null;
        s.username = null;
        s.avatarUrl = null;
        s.isMuted = false;
      }
    });

    // Assign to new seat
    seat.userId = userData.userId;
    seat.displayName = userData.displayName;
    seat.username = userData.username;
    seat.avatarUrl = userData.avatarUrl || null;
    seat.isMuted = false;

    room.markModified('seats');
    await room.save();

    // Mark pending request as accepted
    await this.seatRequestModel.updateMany(
      { roomId, user: userData.userId, status: 'pending' },
      { status: 'accepted' },
    );

    if (this.onSeatsUpdated) {
      this.onSeatsUpdated(roomId, room.seats);
    }

    return room.seats;
  }

  async leaveSeat(roomId: string, seatIndex: number, userId: string): Promise<any[]> {
    const room = await this.voiceRoomModel.findById(roomId);
    if (!room) throw new NotFoundException('Voice room not found');

    const seat = room.seats.find((s) => s.index === seatIndex);
    if (!seat) throw new NotFoundException('Seat not found');

    if (seat.userId && seat.userId.toString() === userId) {
      seat.userId = null;
      seat.displayName = null;
      seat.username = null;
      seat.avatarUrl = null;
      seat.isMuted = false;

      room.markModified('seats');
      await room.save();

      if (this.onSeatsUpdated) {
        this.onSeatsUpdated(roomId, room.seats);
      }
    }

    return room.seats;
  }

  async muteSeat(
    roomId: string,
    seatIndex: number,
    isMuted: boolean,
  ): Promise<any[]> {
    const room = await this.voiceRoomModel.findById(roomId);
    if (!room) throw new NotFoundException('Voice room not found');

    const seat = room.seats.find((s) => s.index === seatIndex);
    if (!seat) throw new NotFoundException('Seat not found');

    seat.isMuted = isMuted;
    room.markModified('seats');
    await room.save();

    if (this.onSeatsUpdated) {
      this.onSeatsUpdated(roomId, room.seats);
    }

    return room.seats;
  }

  async lockSeat(
    roomId: string,
    seatIndex: number,
    isLocked: boolean,
  ): Promise<any[]> {
    const room = await this.voiceRoomModel.findById(roomId);
    if (!room) throw new NotFoundException('Voice room not found');

    const seat = room.seats.find((s) => s.index === seatIndex);
    if (!seat) throw new NotFoundException('Seat not found');

    seat.isLocked = isLocked;
    // If locking an occupied seat, remove the occupant
    if (isLocked && seat.userId) {
      seat.userId = null;
      seat.displayName = null;
      seat.username = null;
      seat.avatarUrl = null;
      seat.isMuted = false;
    }

    room.markModified('seats');
    await room.save();

    if (this.onSeatsUpdated) {
      this.onSeatsUpdated(roomId, room.seats);
    }

    return room.seats;
  }

  async kickSeat(roomId: string, seatIndex: number): Promise<{ seats: any[]; kickedUserId: string | null }> {
    const room = await this.voiceRoomModel.findById(roomId);
    if (!room) throw new NotFoundException('Voice room not found');

    const seat = room.seats.find((s) => s.index === seatIndex);
    if (!seat) throw new NotFoundException('Seat not found');

    const kickedUserId = seat.userId ? seat.userId.toString() : null;

    seat.userId = null;
    seat.displayName = null;
    seat.username = null;
    seat.avatarUrl = null;
    seat.isMuted = false;

    room.markModified('seats');
    await room.save();

    if (this.onSeatsUpdated) {
      this.onSeatsUpdated(roomId, room.seats);
    }

    return { seats: room.seats, kickedUserId };
  }

  // --- SEAT REQUESTS ---

  async createSeatRequest(
    roomId: string,
    userId: string,
    seatIndex = -1,
  ): Promise<SeatRequest> {
    const existing = await this.seatRequestModel.findOne({
      roomId,
      user: userId,
      status: 'pending',
    });

    if (existing) {
      existing.seatIndex = seatIndex;
      return existing.save();
    }

    const request = new this.seatRequestModel({
      roomId,
      user: userId,
      seatIndex,
      status: 'pending',
    });

    return (await request.save()).populate('user', 'displayName username avatarUrl currentLevel levelBadgeUrl');
  }

  async cancelSeatRequest(roomId: string, userId: string): Promise<void> {
    await this.seatRequestModel.updateMany(
      { roomId, user: userId, status: 'pending' },
      { status: 'cancelled' },
    );
  }

  async getPendingRequests(roomId: string): Promise<SeatRequest[]> {
    return this.seatRequestModel
      .find({ roomId, status: 'pending' })
      .populate('user', 'displayName username avatarUrl currentLevel levelBadgeUrl')
      .sort({ createdAt: 1 })
      .exec();
  }

  async respondToSeatRequest(
    requestId: string,
    status: 'accepted' | 'rejected',
  ): Promise<SeatRequest> {
    const request = await this.seatRequestModel.findById(requestId);
    if (!request) {
      throw new NotFoundException('Request not found');
    }
    request.status = status;
    return request.save();
  }

  // --- GIFTS & RANKING ---

  async addGiftsTotal(roomId: string, amount: number): Promise<void> {
    await this.voiceRoomModel.findByIdAndUpdate(roomId, {
      $inc: { totalGiftsReceived: amount },
    });
  }

  // --- AGORA TOKEN GENERATION ---

  generateAgoraToken(
    channelName: string,
    uid: number,
    role: 'publisher' | 'subscriber',
  ): string {
    const appId = this.configService.get<string>('AGORA_APP_ID');
    const appCertificate = this.configService.get<string>(
      'AGORA_APP_CERTIFICATE',
    );

    if (!appId || !appCertificate) {
      throw new Error('Agora credentials are not configured');
    }

    const expireSeconds = 7200; // 2 hours for voice rooms
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

  // --- ADMIN METHODS ---

  async findAllForAdmin(
    page = 1,
    limit = 20,
    status?: string,
  ): Promise<{ data: VoiceRoom[]; total: number }> {
    const skip = (page - 1) * limit;
    const filter: any = {};
    if (status) filter.status = status;

    const [data, total] = await Promise.all([
      this.voiceRoomModel
        .find(filter)
        .sort({ startedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('host', 'displayName username avatarUrl')
        .exec(),
      this.voiceRoomModel.countDocuments(filter).exec(),
    ]);

    return { data, total };
  }

  // --- ZOMBIE ROOM CLEANUP ---

  @Cron(CronExpression.EVERY_MINUTE)
  async cleanupZombieRooms() {
    const ninetySecondsAgo = new Date(Date.now() - 90 * 1000);

    const zombies = await this.voiceRoomModel.find({
      isLive: true,
      lastHeartbeat: { $lt: ninetySecondsAgo },
    });

    if (zombies.length === 0) return;

    this.logger.log(`Found ${zombies.length} zombie voice rooms. Ending them.`);

    const roomIds = zombies.map((r) => r._id.toString());

    await this.voiceRoomModel.updateMany(
      { _id: { $in: roomIds } },
      {
        isLive: false,
        status: 'ended',
        endedAt: new Date(),
      },
    );

    // Cancel pending requests
    await this.seatRequestModel.updateMany(
      { roomId: { $in: roomIds }, status: 'pending' },
      { status: 'cancelled' },
    );

    if (this.onZombieCleanup) {
      try {
        this.onZombieCleanup(roomIds);
      } catch (err) {
        this.logger.error(`Error in onZombieCleanup: ${err.message}`);
      }
    }
  }
}

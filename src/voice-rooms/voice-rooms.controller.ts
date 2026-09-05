import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { VoiceRoomsService } from './voice-rooms.service';
import { CreateVoiceRoomDto } from './dto/create-voice-room.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';

@Controller('voice-rooms')
export class VoiceRoomsController {
  constructor(private readonly voiceRoomsService: VoiceRoomsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(
    @CurrentUser() user: any,
    @Body() createVoiceRoomDto: CreateVoiceRoomDto,
  ) {
    return this.voiceRoomsService.create(user.userId, createVoiceRoomDto);
  }

  @Get()
  async findAll(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('sort') sort: 'viewers' | 'gifts' | 'newest' = 'viewers',
    @Query('category') category?: string,
  ) {
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 20;
    return this.voiceRoomsService.findAllLive(pageNum, limitNum, sort, category);
  }

  @UseGuards(JwtAuthGuard)
  @Get('active/me')
  async getMyActiveRoom(@CurrentUser() user: any) {
    const room = await this.voiceRoomsService.findActiveRoomForUser(user.userId);
    return room || null;
  }

  // --- ADMIN ROUTES (Defined before :id to prevent route shadowing) ---

  @UseGuards(AdminAuthGuard)
  @Get('admin/all')
  async findAllForAdmin(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('status') status?: string,
  ) {
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 20;
    return this.voiceRoomsService.findAllForAdmin(pageNum, limitNum, status);
  }

  @UseGuards(AdminAuthGuard)
  @Delete('admin/:id/force-end')
  async adminForceEndRoom(@Param('id') id: string) {
    return this.voiceRoomsService.endRoom(id, undefined, 'admin_forced');
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.voiceRoomsService.findById(id);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/agora-token')
  async getAgoraToken(@CurrentUser() user: any, @Param('id') id: string) {
    const room = await this.voiceRoomsService.findById(id);

    // Check if user is host or on one of the seats
    const isHost =
      (room.host as any)?._id?.toString() === user.userId ||
      room.host?.toString() === user.userId;

    const isOnSeat = room.seats.some(
      (s) => s.userId && s.userId.toString() === user.userId,
    );

    const initialRole: 'publisher' | 'subscriber' =
      isHost || isOnSeat ? 'publisher' : 'subscriber';

    // Deterministic numeric UID from userId string
    let uid = 0;
    for (let i = 0; i < user.userId.length; i++) {
      uid = (uid << 5) - uid + user.userId.charCodeAt(i);
      uid |= 0;
    }
    uid = Math.abs(uid) || 1;

    // We issue the token with 'publisher' privilege so that when a viewer takes a seat
    // they can seamlessly publish audio without token re-authentication failures.
    const token = this.voiceRoomsService.generateAgoraToken(
      room.channelName,
      uid,
      'publisher',
    );
    const appId = this.voiceRoomsService.getAgoraAppId();

    return {
      token,
      uid,
      channelName: room.channelName,
      role: initialRole,
      appId,
      isHost,
      isOnSeat,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/requests')
  async getPendingRequests(
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    const room = await this.voiceRoomsService.findById(id);
    const hostId =
      (room.host as any)?._id?.toString() || room.host?.toString();
    if (hostId !== user.userId) {
      throw new ForbiddenException('Only the host can view seat requests');
    }
    return this.voiceRoomsService.getPendingRequests(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/heartbeat')
  async heartbeat(@CurrentUser() user: any, @Param('id') id: string) {
    await this.voiceRoomsService.heartbeat(id, user.userId);
    return { success: true };
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async endRoom(@CurrentUser() user: any, @Param('id') id: string) {
    return this.voiceRoomsService.endRoom(id, user.userId, 'host_ended');
  }
}

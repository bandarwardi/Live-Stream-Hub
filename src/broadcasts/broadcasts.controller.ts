import {
  Controller,
  Get,
  Param,
  Query,
  NotFoundException,
  Post,
  Patch,
  Body,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { BroadcastsService } from './broadcasts.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateBroadcastDto } from './dto/create-broadcast.dto';

@Controller('broadcasts')
export class BroadcastsController {
  constructor(private readonly broadcastsService: BroadcastsService) {}

  @UseGuards(AdminAuthGuard)
  @Get('admin/all')
  async getAllForAdmin(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    const pageNum = parseInt(page || '1', 10);
    const limitNum = parseInt(limit || '20', 10);
    return this.broadcastsService.findAllForAdmin(pageNum, limitNum, search);
  }

  @UseGuards(AdminAuthGuard)
  @Patch('admin/:id/end')
  async forceEndBroadcast(@Param('id') id: string) {
    // Calling endBroadcast without userId bypasses broadcaster restriction
    return this.broadcastsService.endBroadcast(id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('my-active')
  async getMyActiveBroadcast(@CurrentUser() user: any) {
    return this.broadcastsService.findActiveBroadcastForUser(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  async createBroadcast(
    @CurrentUser() user: any,
    @Body() dto: CreateBroadcastDto,
  ) {
    return this.broadcastsService.create(user.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/token')
  async getAgoraToken(@CurrentUser() user: any, @Param('id') id: string) {
    const broadcast = await this.broadcastsService.findById(id);
    if (!broadcast) throw new NotFoundException('Broadcast not found');
    if (!broadcast.isLive)
      throw new BadRequestException('Broadcast is no longer live');

    // If the requesting user is the broadcaster, they get publisher role
    const role =
      (broadcast.broadcaster as any)._id.toString() === user.userId
        ? 'publisher'
        : 'subscriber';

    // Generate a deterministic integer uid from user string ID
    let uid = 0;
    for (let i = 0; i < user.userId.length; i++) {
      uid = (uid << 5) - uid + user.userId.charCodeAt(i);
      uid |= 0;
    }
    uid = Math.abs(uid) || 1;

    const token = this.broadcastsService.generateAgoraToken(
      broadcast.channelName,
      uid,
      role,
    );
    const appId = this.broadcastsService.getAgoraAppId();
    return { token, uid, channelName: broadcast.channelName, role, appId };
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/heartbeat')
  async heartbeat(@CurrentUser() user: any, @Param('id') id: string) {
    await this.broadcastsService.heartbeat(id, user.userId);
    return { success: true };
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/end')
  async endBroadcast(@CurrentUser() user: any, @Param('id') id: string) {
    return this.broadcastsService.endBroadcast(id, user.userId);
  }

  @Get()
  async getBroadcasts(
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('broadcasterId') broadcasterId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 20;
    return this.broadcastsService.findAll(
      status,
      category,
      broadcasterId,
      cursor,
      parsedLimit,
    );
  }

  @Get('search')
  async searchBroadcasts(
    @Query('q') q: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 20;
    return this.broadcastsService.search(q, cursor, parsedLimit);
  }

  @Get(':id')
  async getBroadcast(@Param('id') id: string) {
    const broadcast = await this.broadcastsService.findById(id);
    if (!broadcast) throw new NotFoundException('Broadcast not found');
    return broadcast;
  }
}

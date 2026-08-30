import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { ConversationsService } from './conversations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('chat/conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  async getConversations(@CurrentUser() user: any) {
    return this.conversationsService.getConversations(user.userId);
  }

  @Get(':id')
  async getConversationById(@CurrentUser() user: any, @Param('id') id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid conversation ID');
    }
    return this.conversationsService.getConversationById(id);
  }

  @Post(':userId')
  async startConversation(
    @CurrentUser() user: any,
    @Param('userId') targetUserId: string,
  ) {
    if (!targetUserId || !Types.ObjectId.isValid(targetUserId)) {
      throw new BadRequestException('Valid target user ID is required');
    }
    return this.conversationsService.findOrCreateConversation(
      user.userId,
      targetUserId,
    );
  }

  @Get(':id/messages')
  async getMessages(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid conversation ID');
    }
    const parsedLimit = limit ? parseInt(limit, 10) : 30;

    // Mark as read when messages are fetched
    await this.conversationsService.markAsRead(id, user.userId);

    return this.conversationsService.getMessages(id, parsedLimit, cursor);
  }
}

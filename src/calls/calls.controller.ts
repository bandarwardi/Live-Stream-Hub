import {
  Controller,
  Post,
  Body,
  Param,
  Patch,
  Get,
  UseGuards,
} from '@nestjs/common';
import { CallsService } from './calls.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('calls')
@UseGuards(JwtAuthGuard)
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  @Post()
  async initiateCall(
    @CurrentUser() user: any,
    @Body('calleeId') calleeId: string,
    @Body('type') type: 'voice' | 'video',
  ) {
    return this.callsService.initiateCall(user.userId, calleeId, type);
  }

  @Patch(':id/answer')
  async answerCall(@Param('id') callId: string, @CurrentUser() user: any) {
    return this.callsService.answerCall(callId, user.userId);
  }

  @Patch(':id/reject')
  async rejectCall(@Param('id') callId: string, @CurrentUser() user: any) {
    return this.callsService.rejectCall(callId, user.userId);
  }

  @Patch(':id/end')
  async endCall(@Param('id') callId: string, @CurrentUser() user: any) {
    return this.callsService.endCall(callId, user.userId);
  }

  @Get(':id/token')
  async getCallToken(@Param('id') callId: string, @CurrentUser() user: any) {
    return this.callsService.getCallToken(callId, user.userId);
  }

  @Get('history')
  async getCallHistory(@CurrentUser() user: any) {
    return this.callsService.getCallHistory(user.userId);
  }

  @Get(':id')
  async getCallById(@Param('id') callId: string, @CurrentUser() user: any) {
    return this.callsService.getCallById(callId, user.userId);
  }
}

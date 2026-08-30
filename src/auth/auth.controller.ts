import {
  Controller,
  Post,
  Put,
  Body,
  UseGuards,
  Get,
  Req,
  HttpCode,
  HttpStatus,
  Delete,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthGuard } from '@nestjs/passport';
import { UsersService } from '../users/users.service';
import { NotFoundException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CompleteProfileDto } from './dto/complete-profile.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @Post('firebase')
  firebaseLogin(@Body('token') token: string) {
    return this.authService.firebaseLogin(token);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Put('complete-profile')
  completeProfile(@CurrentUser() user: any, @Body() dto: CompleteProfileDto) {
    return this.usersService.updateProfile(user.userId, dto);
  }

  @UseGuards(AuthGuard('jwt-refresh'))
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  refresh(@Req() req: any) {
    return this.authService.refresh(
      req.user.sub,
      req.user.refreshToken,
      req.user.family,
    );
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  logout(@CurrentUser() user: any) {
    return this.authService.logout(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Delete('account')
  async deleteAccount(@CurrentUser() user: any) {
    await this.usersService.softDeleteUser(user.userId);
    return { success: true, message: 'تم حذف الحساب بنجاح' };
  }
}

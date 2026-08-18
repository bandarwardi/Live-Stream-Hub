import { Controller, Get, Patch, Body, UseGuards, UseInterceptors, UploadedFile, Post, BadRequestException, Query, Param, Delete, NotFoundException, Request } from '@nestjs/common';
import { UsersService } from './users.service';
import { FollowsService } from '../follows/follows.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { StorageService } from '../storage/storage.service';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly storageService: StorageService,
    private readonly followsService: FollowsService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getProfile(@CurrentUser() user: any) {
    return this.usersService.findById(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  async updateProfile(@CurrentUser() user: any, @Body() data: any) {
    // We allow updating displayName, bio, username, email
    // Phone can ONLY be updated via /verify-phone endpoint
    const allowedFields = ['displayName', 'bio', 'username', 'email'];
    const updateData: any = {};
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updateData[field] = data[field];
      }
    }
    
    return this.usersService.updateProfile(user.userId, updateData);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAvatar(@CurrentUser() user: any, @UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    const avatarUrl = await this.storageService.uploadFile(file, 'avatars');
    return this.usersService.updateProfile(user.userId, { avatarUrl });
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/cover')
  @UseInterceptors(FileInterceptor('file'))
  async uploadCover(@CurrentUser() user: any, @UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    const coverUrl = await this.storageService.uploadFile(file, 'covers');
    return this.usersService.updateProfile(user.userId, { coverUrl });
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/verify-phone')
  async verifyPhone(@CurrentUser() user: any, @Body('token') token: string) {
    if (!token) throw new BadRequestException('Token is required');
    return this.usersService.verifyPhoneFromFirebaseToken(user.userId, token);
  }

  @Get('search')
  async searchUsers(@Query('q') q: string) {
    return this.usersService.searchUsers(q);
  }

  @Get(':id')
  async getUserProfile(@Param('id') id: string) {
    const user = await this.usersService.findById(id);
    if (!user) throw new NotFoundException('User not found');
    
    const followerCount = await this.followsService.getFollowersCount(id);
    const followingCount = await this.followsService.getFollowingCount(id);
    
    const userObj = user.toJSON();
    return { ...userObj, followerCount, followingCount };
  }

  @UseGuards(JwtAuthGuard)
  @Post('follow/:id')
  async followUser(@CurrentUser() user: any, @Param('id') id: string) {
    await this.followsService.follow(user.userId, id);
    return { success: true };
  }

  @UseGuards(JwtAuthGuard)
  @Delete('follow/:id')
  async unfollowUser(@CurrentUser() user: any, @Param('id') id: string) {
    await this.followsService.unfollow(user.userId, id);
    return { success: true };
  }

  @Get(':id/followers')
  async getFollowers(@Param('id') id: string) {
    return this.followsService.getFollowers(id);
  }

  @Get(':id/following')
  async getFollowing(@Param('id') id: string) {
    return this.followsService.getFollowing(id);
  }
}

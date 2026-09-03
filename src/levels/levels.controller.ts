import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { LevelsService } from './levels.service';
import { CreateLevelDto } from './dto/create-level.dto';
import { UpdateLevelDto } from './dto/update-level.dto';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StorageService } from '../storage/storage.service';

@Controller('levels')
export class LevelsController {
  constructor(
    private readonly levelsService: LevelsService,
    private readonly storageService: StorageService,
  ) {}

  @UseGuards(AdminAuthGuard)
  @Post('admin')
  @UseInterceptors(FileInterceptor('badge'))
  async create(
    @Body() createLevelDto: CreateLevelDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    createLevelDto.level = Number(createLevelDto.level);
    createLevelDto.minXP = Number(createLevelDto.minXP);

    let badgeUrl;
    if (file) {
      badgeUrl = await this.storageService.uploadFile(file, 'levels');
    }
    return this.levelsService.create(createLevelDto, badgeUrl);
  }

  @UseGuards(AdminAuthGuard)
  @Get('admin')
  findAllForAdmin() {
    return this.levelsService.findAllForAdmin();
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll() {
    return this.levelsService.findAllForAdmin();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.levelsService.findById(id);
  }

  @UseGuards(AdminAuthGuard)
  @Patch('admin/:id')
  @UseInterceptors(FileInterceptor('badge'))
  async update(
    @Param('id') id: string,
    @Body() updateLevelDto: UpdateLevelDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    let badgeUrl;
    if (file) {
      badgeUrl = await this.storageService.uploadFile(file, 'levels');
    }
    
    if (updateLevelDto.level !== undefined) updateLevelDto.level = Number(updateLevelDto.level);
    if (updateLevelDto.minXP !== undefined) updateLevelDto.minXP = Number(updateLevelDto.minXP);

    return this.levelsService.update(id, updateLevelDto, badgeUrl);
  }

  @UseGuards(AdminAuthGuard)
  @Delete('admin/:id')
  remove(@Param('id') id: string) {
    return this.levelsService.remove(id);
  }
}

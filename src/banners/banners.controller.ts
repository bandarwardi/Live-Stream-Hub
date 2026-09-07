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
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BannersService } from './banners.service';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { StorageService } from '../storage/storage.service';

@Controller('banners')
export class BannersController {
  constructor(
    private readonly bannersService: BannersService,
    private readonly storageService: StorageService,
  ) {}

  @Get()
  findAllActive() {
    return this.bannersService.findAllActive();
  }

  @UseGuards(AdminAuthGuard)
  @Get('admin')
  findAllForAdmin() {
    return this.bannersService.findAllForAdmin();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.bannersService.findById(id);
  }

  @UseGuards(AdminAuthGuard)
  @Post('admin')
  @UseInterceptors(FileInterceptor('image'))
  async create(
    @Body() createBannerDto: CreateBannerDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    let imageUrl = (createBannerDto as any).imageUrl;
    if (file) {
      imageUrl = await this.storageService.uploadFile(file, 'banners');
    }
    if (!imageUrl) {
      throw new BadRequestException('Banner image is required (either file or imageUrl)');
    }

    if (createBannerDto.sortOrder !== undefined) {
      createBannerDto.sortOrder = Number(createBannerDto.sortOrder);
    }
    if (createBannerDto.isActive !== undefined) {
      createBannerDto.isActive = String(createBannerDto.isActive) === 'true';
    }

    return this.bannersService.create(createBannerDto, imageUrl);
  }

  @UseGuards(AdminAuthGuard)
  @Patch('admin/:id')
  @UseInterceptors(FileInterceptor('image'))
  async update(
    @Param('id') id: string,
    @Body() updateBannerDto: UpdateBannerDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    let imageUrl = (updateBannerDto as any).imageUrl;
    if (file) {
      imageUrl = await this.storageService.uploadFile(file, 'banners');
    }

    if (updateBannerDto.sortOrder !== undefined) {
      updateBannerDto.sortOrder = Number(updateBannerDto.sortOrder);
    }
    if (updateBannerDto.isActive !== undefined) {
      updateBannerDto.isActive = String(updateBannerDto.isActive) === 'true';
    }

    return this.bannersService.update(id, updateBannerDto, imageUrl);
  }

  @UseGuards(AdminAuthGuard)
  @Delete('admin/:id')
  remove(@Param('id') id: string) {
    return this.bannersService.remove(id);
  }
}

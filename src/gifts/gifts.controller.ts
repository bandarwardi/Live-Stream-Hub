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
import { GiftsService } from './gifts.service';
import { CreateGiftDto } from './dto/create-gift.dto';
import { UpdateGiftDto } from './dto/update-gift.dto';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StorageService } from '../storage/storage.service';

@Controller('gifts')
export class GiftsController {
  constructor(
    private readonly giftsService: GiftsService,
    private readonly storageService: StorageService,
  ) {}

  @UseGuards(AdminAuthGuard)
  @Post('admin')
  @UseInterceptors(FileInterceptor('image'))
  async create(
    @Body() createGiftDto: CreateGiftDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Gift image is required');
    }
    // Parse numeric/boolean values from FormData
    createGiftDto.price = Number(createGiftDto.price);
    if (createGiftDto.isActive !== undefined) {
      createGiftDto.isActive = String(createGiftDto.isActive) === 'true';
    }

    const imageUrl = await this.storageService.uploadFile(file, 'gifts');
    return this.giftsService.create(createGiftDto, imageUrl);
  }

  @UseGuards(AdminAuthGuard)
  @Get('admin')
  findAllForAdmin() {
    return this.giftsService.findAllForAdmin();
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  findAllActive() {
    return this.giftsService.findAllActive();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.giftsService.findById(id);
  }

  @UseGuards(AdminAuthGuard)
  @Patch('admin/:id')
  @UseInterceptors(FileInterceptor('image'))
  async update(
    @Param('id') id: string,
    @Body() updateGiftDto: UpdateGiftDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    let imageUrl;
    if (file) {
      imageUrl = await this.storageService.uploadFile(file, 'gifts');
    }
    
    // Parse numeric/boolean values from FormData if present
    if (updateGiftDto.price !== undefined) updateGiftDto.price = Number(updateGiftDto.price);
    if (updateGiftDto.isActive !== undefined) {
      updateGiftDto.isActive = String(updateGiftDto.isActive) === 'true';
    }

    return this.giftsService.update(id, updateGiftDto, imageUrl);
  }

  @UseGuards(AdminAuthGuard)
  @Delete('admin/:id')
  remove(@Param('id') id: string) {
    return this.giftsService.remove(id);
  }
}

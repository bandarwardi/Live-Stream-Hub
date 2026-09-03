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
import { StoreService } from './store.service';
import { CreateStoreItemDto } from './dto/create-store-item.dto';
import { UpdateStoreItemDto } from './dto/update-store-item.dto';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StorageService } from '../storage/storage.service';

@Controller('store')
export class StoreController {
  constructor(
    private readonly storeService: StoreService,
    private readonly storageService: StorageService,
  ) {}

  @UseGuards(AdminAuthGuard)
  @Post('admin')
  @UseInterceptors(FileInterceptor('image'))
  async create(
    @Body() createStoreItemDto: CreateStoreItemDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Store item image is required');
    }
    // Parse numeric/boolean values from FormData
    createStoreItemDto.price = Number(createStoreItemDto.price);
    createStoreItemDto.durationDays = Number(createStoreItemDto.durationDays);
    if (createStoreItemDto.isActive !== undefined) {
      createStoreItemDto.isActive = String(createStoreItemDto.isActive) === 'true';
    }

    const imageUrl = await this.storageService.uploadFile(file, 'store');
    return this.storeService.create(createStoreItemDto, imageUrl);
  }

  @UseGuards(AdminAuthGuard)
  @Get('admin')
  findAllForAdmin() {
    return this.storeService.findAllForAdmin();
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  findAllActive() {
    return this.storeService.findAllActive();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.storeService.findById(id);
  }

  @UseGuards(AdminAuthGuard)
  @Patch('admin/:id')
  @UseInterceptors(FileInterceptor('image'))
  async update(
    @Param('id') id: string,
    @Body() updateStoreItemDto: UpdateStoreItemDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    let imageUrl;
    if (file) {
      imageUrl = await this.storageService.uploadFile(file, 'store');
    }
    
    // Parse numeric/boolean values from FormData if present
    if (updateStoreItemDto.price !== undefined) updateStoreItemDto.price = Number(updateStoreItemDto.price);
    if (updateStoreItemDto.durationDays !== undefined) updateStoreItemDto.durationDays = Number(updateStoreItemDto.durationDays);
    if (updateStoreItemDto.isActive !== undefined) {
      updateStoreItemDto.isActive = String(updateStoreItemDto.isActive) === 'true';
    }

    return this.storeService.update(id, updateStoreItemDto, imageUrl);
  }

  @UseGuards(AdminAuthGuard)
  @Delete('admin/:id')
  remove(@Param('id') id: string) {
    return this.storeService.remove(id);
  }
}

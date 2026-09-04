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
  UploadedFiles,
  BadRequestException,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
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
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'image', maxCount: 1 },
      { name: 'animation', maxCount: 1 },
    ]),
  )
  async create(
    @Body() createStoreItemDto: CreateStoreItemDto,
    @UploadedFiles()
    files: {
      image?: Express.Multer.File[];
      animation?: Express.Multer.File[];
    },
  ) {
    const imageFile = files?.image?.[0];
    if (!imageFile) {
      throw new BadRequestException('Store item image is required');
    }
    // Parse numeric/boolean values from FormData
    createStoreItemDto.price = Number(createStoreItemDto.price);
    createStoreItemDto.durationDays = Number(createStoreItemDto.durationDays);
    if (createStoreItemDto.isActive !== undefined) {
      createStoreItemDto.isActive = String(createStoreItemDto.isActive) === 'true';
    }

    const imageUrl = await this.storageService.uploadFile(imageFile, 'store');

    let animationUrl: string | undefined = createStoreItemDto.animationUrl;
    const animationFile = files?.animation?.[0];
    if (animationFile) {
      animationUrl = await this.storageService.uploadFile(animationFile, 'store/animations');
    }

    return this.storeService.create(createStoreItemDto, imageUrl, animationUrl);
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
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'image', maxCount: 1 },
      { name: 'animation', maxCount: 1 },
    ]),
  )
  async update(
    @Param('id') id: string,
    @Body() updateStoreItemDto: UpdateStoreItemDto,
    @UploadedFiles()
    files?: {
      image?: Express.Multer.File[];
      animation?: Express.Multer.File[];
    },
  ) {
    let imageUrl: string | undefined;
    const imageFile = files?.image?.[0];
    if (imageFile) {
      imageUrl = await this.storageService.uploadFile(imageFile, 'store');
    }

    let animationUrl: string | undefined = updateStoreItemDto.animationUrl;
    const animationFile = files?.animation?.[0];
    if (animationFile) {
      animationUrl = await this.storageService.uploadFile(animationFile, 'store/animations');
    }
    
    // Parse numeric/boolean values from FormData if present
    if (updateStoreItemDto.price !== undefined) updateStoreItemDto.price = Number(updateStoreItemDto.price);
    if (updateStoreItemDto.durationDays !== undefined) updateStoreItemDto.durationDays = Number(updateStoreItemDto.durationDays);
    if (updateStoreItemDto.isActive !== undefined) {
      updateStoreItemDto.isActive = String(updateStoreItemDto.isActive) === 'true';
    }

    return this.storeService.update(id, updateStoreItemDto, imageUrl, animationUrl);
  }

  @UseGuards(AdminAuthGuard)
  @Delete('admin/:id')
  remove(@Param('id') id: string) {
    return this.storeService.remove(id);
  }
}

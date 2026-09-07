import { Injectable, NotFoundException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Banner } from './schemas/banner.schema';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';

@Injectable()
export class BannersService implements OnModuleInit {
  constructor(@InjectModel(Banner.name) private bannerModel: Model<Banner>) {}

  async onModuleInit() {
    await this.seed();
  }

  async seed() {
    const count = await this.bannerModel.countDocuments();
    if (count === 0) {
      const defaultBanners = [
        {
          title: 'Live Social Hub - Connect & Earn',
          imageUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1000&auto=format&fit=crop',
          linkUrl: 'room',
          isActive: true,
          sortOrder: 1,
        },
        {
          title: 'PK Battles Championship',
          imageUrl: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=1000&auto=format&fit=crop',
          linkUrl: 'ranking',
          isActive: true,
          sortOrder: 2,
        },
        {
          title: 'Join Voice Party Rooms',
          imageUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?q=80&w=1000&auto=format&fit=crop',
          linkUrl: 'voice-rooms',
          isActive: true,
          sortOrder: 3,
        },
      ];
      await this.bannerModel.insertMany(defaultBanners);
    }
  }

  async findAllActive(): Promise<Banner[]> {
    return this.bannerModel.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).exec();
  }

  async findAllForAdmin(): Promise<Banner[]> {
    return this.bannerModel.find().sort({ sortOrder: 1, createdAt: -1 }).exec();
  }

  async findById(id: string): Promise<Banner> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid banner ID');
    }
    const banner = await this.bannerModel.findById(id).exec();
    if (!banner) {
      throw new NotFoundException(`Banner with ID ${id} not found`);
    }
    return banner;
  }

  async create(createBannerDto: CreateBannerDto, imageUrl: string): Promise<Banner> {
    const createdBanner = new this.bannerModel({
      ...createBannerDto,
      imageUrl,
    });
    return createdBanner.save();
  }

  async update(id: string, updateBannerDto: UpdateBannerDto, imageUrl?: string): Promise<Banner> {
    const banner = await this.findById(id);

    if (updateBannerDto.title !== undefined) banner.title = updateBannerDto.title;
    if (updateBannerDto.linkUrl !== undefined) banner.linkUrl = updateBannerDto.linkUrl;
    if (updateBannerDto.sortOrder !== undefined) banner.sortOrder = updateBannerDto.sortOrder;
    if (updateBannerDto.isActive !== undefined) banner.isActive = updateBannerDto.isActive;
    if (imageUrl !== undefined) banner.imageUrl = imageUrl;

    return banner.save();
  }

  async remove(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid banner ID');
    }
    const result = await this.bannerModel.deleteOne({ _id: id }).exec();
    if (result.deletedCount === 0) {
      throw new NotFoundException(`Banner with ID ${id} not found`);
    }
  }
}

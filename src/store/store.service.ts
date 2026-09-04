import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { StoreItem } from './schemas/store-item.schema';
import { CreateStoreItemDto } from './dto/create-store-item.dto';
import { UpdateStoreItemDto } from './dto/update-store-item.dto';

@Injectable()
export class StoreService {
  constructor(@InjectModel(StoreItem.name) private storeItemModel: Model<StoreItem>) {}

  async create(createStoreItemDto: CreateStoreItemDto, imageUrl: string, animationUrl?: string): Promise<StoreItem> {
    const createdItem = new this.storeItemModel({
      ...createStoreItemDto,
      imageUrl,
      animationUrl: animationUrl || createStoreItemDto.animationUrl || null,
    });
    return createdItem.save();
  }

  async findAllForAdmin(): Promise<StoreItem[]> {
    return this.storeItemModel.find().sort({ type: 1, price: 1 }).exec();
  }

  async findAllActive(): Promise<StoreItem[]> {
    return this.storeItemModel.find({ isActive: true }).sort({ type: 1, price: 1 }).exec();
  }

  async findById(id: string): Promise<StoreItem> {
    if (!id || !require('mongoose').Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Invalid store item ID: ${id}`);
    }
    const item = await this.storeItemModel.findById(id).exec();
    if (!item) {
      throw new NotFoundException(`StoreItem with ID ${id} not found`);
    }
    return item;
  }

  async findByName(name: string): Promise<StoreItem | null> {
    return this.storeItemModel.findOne({ name }).exec();
  }


  async update(id: string, updateStoreItemDto: UpdateStoreItemDto, imageUrl?: string, animationUrl?: string): Promise<StoreItem> {
    const item = await this.findById(id);
    
    if (updateStoreItemDto.name !== undefined) item.name = updateStoreItemDto.name;
    if (updateStoreItemDto.description !== undefined) item.description = updateStoreItemDto.description;
    if (updateStoreItemDto.price !== undefined) item.price = updateStoreItemDto.price;
    if (updateStoreItemDto.durationDays !== undefined) item.durationDays = updateStoreItemDto.durationDays;
    if (updateStoreItemDto.type !== undefined) item.type = updateStoreItemDto.type;
    if (updateStoreItemDto.isActive !== undefined) item.isActive = updateStoreItemDto.isActive;
    if (imageUrl !== undefined) item.imageUrl = imageUrl;
    if (animationUrl !== undefined) {
      item.animationUrl = animationUrl;
    } else if (updateStoreItemDto.animationUrl !== undefined) {
      item.animationUrl = updateStoreItemDto.animationUrl;
    }

    return item.save();
  }

  async remove(id: string): Promise<void> {
    const result = await this.storeItemModel.deleteOne({ _id: id }).exec();
    if (result.deletedCount === 0) {
      throw new NotFoundException(`StoreItem with ID ${id} not found`);
    }
  }
}

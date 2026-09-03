import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Gift } from './schemas/gift.schema';
import { CreateGiftDto } from './dto/create-gift.dto';
import { UpdateGiftDto } from './dto/update-gift.dto';

@Injectable()
export class GiftsService {
  constructor(@InjectModel(Gift.name) private giftModel: Model<Gift>) {}

  async create(createGiftDto: CreateGiftDto, imageUrl: string): Promise<Gift> {
    const createdGift = new this.giftModel({
      ...createGiftDto,
      imageUrl,
    });
    return createdGift.save();
  }

  async findAllForAdmin(): Promise<Gift[]> {
    return this.giftModel.find().sort({ price: 1 }).exec();
  }

  async findAllActive(): Promise<Gift[]> {
    return this.giftModel.find({ isActive: true }).sort({ price: 1 }).exec();
  }

  async findById(id: string): Promise<Gift> {
    const gift = await this.giftModel.findById(id).exec();
    if (!gift) {
      throw new NotFoundException(`Gift with ID ${id} not found`);
    }
    return gift;
  }

  async update(id: string, updateGiftDto: UpdateGiftDto, imageUrl?: string): Promise<Gift> {
    const gift = await this.findById(id);
    
    if (updateGiftDto.name !== undefined) gift.name = updateGiftDto.name;
    if (updateGiftDto.description !== undefined) gift.description = updateGiftDto.description;
    if (updateGiftDto.price !== undefined) gift.price = updateGiftDto.price;
    if (updateGiftDto.isActive !== undefined) gift.isActive = updateGiftDto.isActive;
    if (imageUrl !== undefined) gift.imageUrl = imageUrl;

    return gift.save();
  }

  async remove(id: string): Promise<void> {
    const result = await this.giftModel.deleteOne({ _id: id }).exec();
    if (result.deletedCount === 0) {
      throw new NotFoundException(`Gift with ID ${id} not found`);
    }
  }
}

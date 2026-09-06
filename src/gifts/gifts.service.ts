import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Gift } from './schemas/gift.schema';
import { CreateGiftDto } from './dto/create-gift.dto';
import { UpdateGiftDto } from './dto/update-gift.dto';

@Injectable()
export class GiftsService implements OnModuleInit {
  constructor(@InjectModel(Gift.name) private giftModel: Model<Gift>) {}

  async onModuleInit() {
    await this.seed();
  }

  async seed() {
    const count = await this.giftModel.countDocuments();
    if (count === 0) {
      const defaultGifts = [
        { name: 'Rose', price: 10, description: 'A lovely red rose', imageUrl: 'https://cdn-icons-png.flaticon.com/512/833/833472.png', isActive: true },
        { name: 'Crown', price: 120, description: 'A royal crown', imageUrl: 'https://cdn-icons-png.flaticon.com/512/3232/3232772.png', isActive: true },
        { name: 'Diamond', price: 500, description: 'A shining diamond', imageUrl: 'https://cdn-icons-png.flaticon.com/512/2618/2618245.png', isActive: true },
        { name: 'Fire', price: 800, description: 'Blazing flame', imageUrl: 'https://cdn-icons-png.flaticon.com/512/785/785116.png', isActive: true },
        { name: 'Star', price: 1000, description: 'Superstar magic', imageUrl: 'https://cdn-icons-png.flaticon.com/512/1828/1828884.png', isActive: true },
        { name: 'Rocket', price: 2500, description: 'To the moon!', imageUrl: 'https://cdn-icons-png.flaticon.com/512/1356/1356479.png', isActive: true },
      ];
      await this.giftModel.insertMany(defaultGifts);
    }
  }

  async findByIdOrName(idOrName: string): Promise<Gift | null> {
    if (!idOrName) return null;
    if (Types.ObjectId.isValid(idOrName)) {
      const gift = await this.giftModel.findById(idOrName).exec();
      if (gift) return gift;
    }
    return this.giftModel
      .findOne({
        name: { $regex: new RegExp(`^${idOrName}$`, 'i') },
        isActive: true,
      })
      .exec();
  }

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

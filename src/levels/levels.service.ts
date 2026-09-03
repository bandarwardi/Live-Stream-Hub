import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Level } from './schemas/level.schema';
import { CreateLevelDto } from './dto/create-level.dto';
import { UpdateLevelDto } from './dto/update-level.dto';

@Injectable()
export class LevelsService {
  constructor(@InjectModel(Level.name) private levelModel: Model<Level>) {}

  async create(createLevelDto: CreateLevelDto, badgeUrl?: string): Promise<Level> {
    const existing = await this.levelModel.findOne({ level: createLevelDto.level });
    if (existing) throw new ConflictException(`Level ${createLevelDto.level} already exists`);

    const createdLevel = new this.levelModel({
      ...createLevelDto,
      badgeUrl,
    });
    return createdLevel.save();
  }

  async findAllForAdmin(): Promise<Level[]> {
    return this.levelModel.find().sort({ level: 1 }).exec();
  }

  async findById(id: string): Promise<Level> {
    const level = await this.levelModel.findById(id).exec();
    if (!level) {
      throw new NotFoundException(`Level with ID ${id} not found`);
    }
    return level;
  }

  async update(id: string, updateLevelDto: UpdateLevelDto, badgeUrl?: string): Promise<Level> {
    const levelObj = await this.findById(id);
    
    if (updateLevelDto.level !== undefined && updateLevelDto.level !== levelObj.level) {
      const existing = await this.levelModel.findOne({ level: updateLevelDto.level });
      if (existing) throw new ConflictException(`Level ${updateLevelDto.level} already exists`);
      levelObj.level = updateLevelDto.level;
    }
    
    if (updateLevelDto.name !== undefined) levelObj.name = updateLevelDto.name;
    if (updateLevelDto.minXP !== undefined) levelObj.minXP = updateLevelDto.minXP;
    if (updateLevelDto.color !== undefined) levelObj.color = updateLevelDto.color;
    if (badgeUrl !== undefined) levelObj.badgeUrl = badgeUrl;

    return levelObj.save();
  }

  async remove(id: string): Promise<void> {
    const result = await this.levelModel.deleteOne({ _id: id }).exec();
    if (result.deletedCount === 0) {
      throw new NotFoundException(`Level with ID ${id} not found`);
    }
  }
}

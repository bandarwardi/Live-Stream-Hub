import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Setting } from './schemas/setting.schema';
import { CreateSettingDto } from './dto/create-setting.dto';
import { UpdateSettingDto } from './dto/update-setting.dto';

@Injectable()
export class SettingsService {
  constructor(@InjectModel(Setting.name) private settingModel: Model<Setting>) {}

  async create(createSettingDto: CreateSettingDto): Promise<Setting> {
    const existing = await this.settingModel.findOne({ key: createSettingDto.key });
    if (existing) {
      throw new ConflictException(`Setting with key ${createSettingDto.key} already exists`);
    }
    const setting = new this.settingModel(createSettingDto);
    return setting.save();
  }

  async findAll(): Promise<Setting[]> {
    return this.settingModel.find().exec();
  }

  async findByKey(key: string): Promise<Setting> {
    const setting = await this.settingModel.findOne({ key }).exec();
    if (!setting) {
      throw new NotFoundException(`Setting with key ${key} not found`);
    }
    return setting;
  }

  async update(key: string, updateSettingDto: UpdateSettingDto): Promise<Setting> {
    const setting = await this.settingModel.findOneAndUpdate(
      { key },
      updateSettingDto,
      { new: true }
    ).exec();
    if (!setting) {
      throw new NotFoundException(`Setting with key ${key} not found`);
    }
    return setting;
  }

  async remove(key: string): Promise<void> {
    const result = await this.settingModel.deleteOne({ key }).exec();
    if (result.deletedCount === 0) {
      throw new NotFoundException(`Setting with key ${key} not found`);
    }
  }
}

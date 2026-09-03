import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Admin, AdminDocument } from './schemas/admin.schema';

@Injectable()
export class AdminsService {
  constructor(
    @InjectModel(Admin.name) private adminModel: Model<AdminDocument>,
  ) {}

  async findByUsername(username: string): Promise<AdminDocument | null> {
    return this.adminModel.findOne({ username, isActive: true }).exec();
  }

  async findById(id: string): Promise<AdminDocument | null> {
    return this.adminModel.findOne({ _id: id, isActive: true }).exec();
  }

  async create(createAdminDto: any): Promise<AdminDocument> {
    const createdAdmin = new this.adminModel(createAdminDto);
    return createdAdmin.save();
  }
}

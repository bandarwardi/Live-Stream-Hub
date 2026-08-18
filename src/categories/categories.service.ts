import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Category } from './schemas/category.schema';
import { seedCategories } from './seeds/categories.seed';

@Injectable()
export class CategoriesService implements OnModuleInit {
  constructor(@InjectModel(Category.name) private categoryModel: Model<Category>) {}

  async onModuleInit() {
    await this.seed();
  }

  async findAll() {
    return this.categoryModel.find().sort({ sortOrder: 1 }).exec();
  }

  async create(data: Partial<Category>) {
    return this.categoryModel.create(data);
  }

  async update(id: string, data: Partial<Category>) {
    return this.categoryModel.findByIdAndUpdate(id, data, { new: true }).exec();
  }

  async delete(id: string) {
    return this.categoryModel.findByIdAndDelete(id).exec();
  }

  async seed() {
    const count = await this.categoryModel.countDocuments();
    if (count === 0) {
      await this.categoryModel.insertMany(seedCategories);
    }
  }
}

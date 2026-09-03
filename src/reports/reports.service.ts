import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Report } from './schemas/report.schema';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';

@Injectable()
export class ReportsService {
  constructor(@InjectModel(Report.name) private reportModel: Model<Report>) {}

  async create(reporterId: string, createReportDto: CreateReportDto): Promise<Report> {
    const report = new this.reportModel({
      ...createReportDto,
      reporter: reporterId,
    });
    return report.save();
  }

  async findAllForAdmin(page: number = 1, limit: number = 20, status?: string): Promise<{ data: Report[]; total: number }> {
    const skip = (page - 1) * limit;
    const query: any = {};

    if (status) {
      query.status = status;
    }

    const [data, total] = await Promise.all([
      this.reportModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('reporter', 'username displayName avatarUrl')
        .populate('reportedUser', 'username displayName avatarUrl')
        .populate('reportedBroadcast', 'title isLive')
        .exec(),
      this.reportModel.countDocuments(query).exec(),
    ]);

    return { data, total };
  }

  async findById(id: string): Promise<Report> {
    const report = await this.reportModel
      .findById(id)
      .populate('reporter', 'username displayName avatarUrl')
      .populate('reportedUser', 'username displayName avatarUrl')
      .populate('reportedBroadcast', 'title isLive')
      .exec();
    
    if (!report) {
      throw new NotFoundException(`Report with ID ${id} not found`);
    }
    return report;
  }

  async update(id: string, updateReportDto: UpdateReportDto): Promise<Report> {
    const report = await this.reportModel.findByIdAndUpdate(id, updateReportDto, { new: true }).exec();
    if (!report) {
      throw new NotFoundException(`Report with ID ${id} not found`);
    }
    return report;
  }
}

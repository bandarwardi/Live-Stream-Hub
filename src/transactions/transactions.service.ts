import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Transaction } from './schemas/transaction.schema';
import { CreateTransactionDto } from './dto/create-transaction.dto';

@Injectable()
export class TransactionsService {
  constructor(
    @InjectModel(Transaction.name) private transactionModel: Model<Transaction>,
  ) {}

  async create(createTransactionDto: CreateTransactionDto): Promise<Transaction> {
    const transaction = new this.transactionModel(createTransactionDto);
    return transaction.save();
  }

  async findAllForAdmin(
    page: number = 1,
    limit: number = 20,
    type?: string,
    status?: string,
  ): Promise<{ data: Transaction[]; total: number }> {
    const skip = (page - 1) * limit;
    const query: any = {};

    if (type) query.type = type;
    if (status) query.status = status;

    const [data, total] = await Promise.all([
      this.transactionModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('user', 'username displayName avatarUrl')
        .exec(),
      this.transactionModel.countDocuments(query).exec(),
    ]);

    return { data, total };
  }

  async findByUserId(userId: string): Promise<Transaction[]> {
    return this.transactionModel
      .find({ user: userId })
      .sort({ createdAt: -1 })
      .exec();
  }

  async updateStatus(id: string, status: string): Promise<Transaction> {
    const transaction = await this.transactionModel
      .findByIdAndUpdate(id, { status }, { new: true })
      .exec();
    if (!transaction) {
      throw new NotFoundException(`Transaction with ID ${id} not found`);
    }
    return transaction;
  }
}

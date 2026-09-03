import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Ticket } from './schemas/ticket.schema';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { ReplyTicketDto } from './dto/reply-ticket.dto';

@Injectable()
export class TicketsService {
  constructor(@InjectModel(Ticket.name) private ticketModel: Model<Ticket>) {}

  async create(userId: string, createTicketDto: CreateTicketDto): Promise<Ticket> {
    const ticket = new this.ticketModel({
      ...createTicketDto,
      user: userId,
    });
    return ticket.save();
  }

  async findAllForAdmin(
    page: number = 1,
    limit: number = 20,
    status?: string,
  ): Promise<{ data: Ticket[]; total: number }> {
    const skip = (page - 1) * limit;
    const query: any = {};
    if (status) query.status = status;

    const [data, total] = await Promise.all([
      this.ticketModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('user', 'username displayName avatarUrl email')
        .populate('replies.senderId', 'username displayName avatarUrl role')
        .exec(),
      this.ticketModel.countDocuments(query).exec(),
    ]);

    return { data, total };
  }

  async findByUserId(userId: string): Promise<Ticket[]> {
    return this.ticketModel
      .find({ user: userId })
      .sort({ createdAt: -1 })
      .populate('replies.senderId', 'username displayName avatarUrl role')
      .exec();
  }

  async findById(id: string): Promise<Ticket> {
    const ticket = await this.ticketModel
      .findById(id)
      .populate('user', 'username displayName avatarUrl email')
      .populate('replies.senderId', 'username displayName avatarUrl role')
      .exec();
    if (!ticket) {
      throw new NotFoundException(`Ticket with ID ${id} not found`);
    }
    return ticket;
  }

  async update(id: string, updateTicketDto: UpdateTicketDto): Promise<Ticket> {
    const ticket = await this.ticketModel
      .findByIdAndUpdate(id, updateTicketDto, { new: true })
      .populate('user', 'username displayName avatarUrl email')
      .populate('replies.senderId', 'username displayName avatarUrl role')
      .exec();
    if (!ticket) {
      throw new NotFoundException(`Ticket with ID ${id} not found`);
    }
    return ticket;
  }

  async addReply(id: string, senderId: string, replyDto: ReplyTicketDto): Promise<Ticket> {
    const ticket = await this.ticketModel.findById(id);
    if (!ticket) throw new NotFoundException(`Ticket with ID ${id} not found`);

    ticket.replies.push({
      senderId,
      message: replyDto.message,
      createdAt: new Date(),
    } as any);

    if (ticket.status === 'open') {
      ticket.status = 'in_progress';
    }

    await ticket.save();
    return this.findById(id);
  }
}

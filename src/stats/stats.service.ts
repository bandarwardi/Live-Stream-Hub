import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../users/schemas/user.schema';
import { Broadcast } from '../broadcasts/schemas/broadcast.schema';
import { Transaction } from '../transactions/schemas/transaction.schema';
import { Report } from '../reports/schemas/report.schema';
import { Ticket } from '../tickets/schemas/ticket.schema';

@Injectable()
export class StatsService {
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Broadcast.name) private broadcastModel: Model<Broadcast>,
    @InjectModel(Transaction.name) private transactionModel: Model<Transaction>,
    @InjectModel(Report.name) private reportModel: Model<Report>,
    @InjectModel(Ticket.name) private ticketModel: Model<Ticket>,
  ) {}

  async getDashboardStats() {
    const [
      totalUsers,
      activeStreams,
      revenueResult,
      giftsResult,
      topStreamers,
      pendingReports,
      openTickets,
      recentReports,
      recentTickets
    ] = await Promise.all([
      this.userModel.countDocuments({ isDeleted: false }).exec(),
      this.broadcastModel.countDocuments({ isLive: true }).exec(),
      this.transactionModel.aggregate([
        { $match: { type: 'store_purchase', status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]).exec(),
      this.transactionModel.countDocuments({ type: 'gift_received', status: 'completed' }).exec(),
      this.broadcastModel
        .find()
        .sort({ viewerCount: -1 })
        .limit(5)
        .populate('broadcaster', 'displayName username avatarUrl')
        .exec(),
      this.reportModel.countDocuments({ status: 'pending' }).exec(),
      this.ticketModel.countDocuments({ status: 'open' }).exec(),
      this.reportModel.find().sort({ createdAt: -1 }).limit(4).exec(),
      this.ticketModel.find().sort({ createdAt: -1 }).limit(4).exec(),
    ]);

    const totalRevenue = revenueResult[0]?.total || 0;
    
    // Merge recent activity
    const activity = [
      ...recentReports.map(r => ({
        id: r._id.toString(),
        kind: 'report',
        text: 'بلاغ جديد تم رفعه',
        time: (r as any).createdAt.toISOString()
      })),
      ...recentTickets.map(t => ({
        id: t._id.toString(),
        kind: 'ticket',
        text: 'تذكرة دعم جديدة',
        time: (t as any).createdAt.toISOString()
      }))
    ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 8);

    const formattedStreamers = topStreamers.map(s => {
      const broadcaster = s.broadcaster as any;
      return {
        id: s._id.toString(),
        name: broadcaster?.displayName || broadcaster?.username || 'Unknown',
        avatarHue: Math.floor(Math.random() * 360),
        revenue: s.viewerCount * 10,
        avgViewers: s.viewerCount,
        gifts: Math.floor(s.viewerCount / 2),
      };
    });

    return {
      totalUsers,
      activeStreams,
      totalRevenue,
      giftsReceived: giftsResult,
      topStreamers: formattedStreamers,
      recentActivity: activity,
      operationalAlerts: {
        pendingReports,
        openTickets,
      }
    };
  }
}

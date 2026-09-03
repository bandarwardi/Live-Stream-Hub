import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Broadcast, BroadcastSchema } from '../broadcasts/schemas/broadcast.schema';
import { Transaction, TransactionSchema } from '../transactions/schemas/transaction.schema';
import { Report, ReportSchema } from '../reports/schemas/report.schema';
import { Ticket, TicketSchema } from '../tickets/schemas/ticket.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Broadcast.name, schema: BroadcastSchema },
      { name: Transaction.name, schema: TransactionSchema },
      { name: Report.name, schema: ReportSchema },
      { name: Ticket.name, schema: TicketSchema },
    ]),
  ],
  controllers: [StatsController],
  providers: [StatsService],
  exports: [StatsService],
})
export class StatsModule {}

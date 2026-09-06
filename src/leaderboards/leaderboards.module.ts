import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LeaderboardsController } from './leaderboards.controller';
import { LeaderboardsService } from './leaderboards.service';
import {
  Transaction,
  TransactionSchema,
} from '../transactions/schemas/transaction.schema';
import { User, UserSchema } from '../users/schemas/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [LeaderboardsController],
  providers: [LeaderboardsService],
  exports: [LeaderboardsService],
})
export class LeaderboardsModule {}

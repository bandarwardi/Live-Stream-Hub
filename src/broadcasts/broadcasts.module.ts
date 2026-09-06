import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Broadcast, BroadcastSchema } from './schemas/broadcast.schema';
import { BroadcastsService } from './broadcasts.service';
import { BroadcastsController } from './broadcasts.controller';
import { UsersModule } from '../users/users.module';
import { LevelsModule } from '../levels/levels.module';
import { SettingsModule } from '../settings/settings.module';
import { TransactionsModule } from '../transactions/transactions.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Broadcast.name, schema: BroadcastSchema },
    ]),
    UsersModule,
    LevelsModule,
    SettingsModule,
    TransactionsModule,
  ],
  controllers: [BroadcastsController],
  providers: [BroadcastsService],
  exports: [BroadcastsService],
})
export class BroadcastsModule {}

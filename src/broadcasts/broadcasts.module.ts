import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Broadcast, BroadcastSchema } from './schemas/broadcast.schema';
import { BroadcastsService } from './broadcasts.service';
import { BroadcastsController } from './broadcasts.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Broadcast.name, schema: BroadcastSchema },
    ]),
  ],
  controllers: [BroadcastsController],
  providers: [BroadcastsService],
  exports: [BroadcastsService],
})
export class BroadcastsModule {}

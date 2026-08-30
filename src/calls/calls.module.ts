import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { Call, CallSchema } from './schemas/call.schema';
import { BroadcastsModule } from '../broadcasts/broadcasts.module';
import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Call.name, schema: CallSchema }]),
    BroadcastsModule, // For generateAgoraToken
    ChatModule, // For ChatGateway signaling
  ],
  controllers: [CallsController],
  providers: [CallsService],
  exports: [CallsService],
})
export class CallsModule {}

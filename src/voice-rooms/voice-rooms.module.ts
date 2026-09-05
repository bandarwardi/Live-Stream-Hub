import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { VoiceRoom, VoiceRoomSchema } from './schemas/voice-room.schema';
import {
  SeatRequest,
  SeatRequestSchema,
} from './schemas/seat-request.schema';
import { VoiceRoomsService } from './voice-rooms.service';
import { VoiceRoomsController } from './voice-rooms.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: VoiceRoom.name, schema: VoiceRoomSchema },
      { name: SeatRequest.name, schema: SeatRequestSchema },
    ]),
    UsersModule,
  ],
  controllers: [VoiceRoomsController],
  providers: [VoiceRoomsService],
  exports: [VoiceRoomsService],
})
export class VoiceRoomsModule {}

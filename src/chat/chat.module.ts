import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Message, MessageSchema } from './schemas/message.schema';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import {
  Conversation,
  ConversationSchema,
} from './schemas/conversation.schema';
import {
  DirectMessage,
  DirectMessageSchema,
} from './schemas/direct-message.schema';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';
import { BroadcastsModule } from '../broadcasts/broadcasts.module';
import { UsersModule } from '../users/users.module';
import { FirebaseModule } from '../firebase/firebase.module';
import { LevelsModule } from '../levels/levels.module';
import { VoiceRoomsModule } from '../voice-rooms/voice-rooms.module';
import { TransactionsModule } from '../transactions/transactions.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Message.name, schema: MessageSchema },
      { name: Conversation.name, schema: ConversationSchema },
      { name: DirectMessage.name, schema: DirectMessageSchema },
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_ACCESS_SECRET'),
      }),
      inject: [ConfigService],
    }),
    BroadcastsModule,
    VoiceRoomsModule,
    TransactionsModule,
    UsersModule,
    FirebaseModule,
    LevelsModule,
  ],
  controllers: [ConversationsController],
  providers: [ChatService, ChatGateway, ConversationsService],
  exports: [ChatService, ConversationsService, ChatGateway],
})
export class ChatModule {}


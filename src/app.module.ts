import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthController } from './health/health.controller';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { FirebaseModule } from './firebase/firebase.module';
import { CategoriesModule } from './categories/categories.module';
import { BroadcastsModule } from './broadcasts/broadcasts.module';
import { ChatModule } from './chat/chat.module';
import { CallsModule } from './calls/calls.module';
import { StorageModule } from './storage/storage.module';
import { AdminsModule } from './admins/admins.module';
import { GiftsModule } from './gifts/gifts.module';
import { StoreModule } from './store/store.module';
import { LevelsModule } from './levels/levels.module';
import { TransactionsModule } from './transactions/transactions.module';
import { SettingsModule } from './settings/settings.module';
import { TicketsModule } from './tickets/tickets.module';
import { StatsModule } from './stats/stats.module';
import { VoiceRoomsModule } from './voice-rooms/voice-rooms.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI'),
      }),
      inject: [ConfigService],
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 10,
      },
    ]),
    FirebaseModule,
    UsersModule,
    AuthModule,
    CategoriesModule,
    BroadcastsModule,
    VoiceRoomsModule,
    ChatModule,
    CallsModule,
    StorageModule,
    AdminsModule,
    GiftsModule,
    StoreModule,
    LevelsModule,
    TransactionsModule,
    SettingsModule,
    TicketsModule,
    StatsModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}

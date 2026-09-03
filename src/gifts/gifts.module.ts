import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GiftsService } from './gifts.service';
import { GiftsController } from './gifts.controller';
import { Gift, GiftSchema } from './schemas/gift.schema';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Gift.name, schema: GiftSchema }]),
    StorageModule,
  ],
  controllers: [GiftsController],
  providers: [GiftsService],
  exports: [GiftsService],
})
export class GiftsModule {}

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StoreService } from './store.service';
import { StoreController } from './store.controller';
import { StoreItem, StoreItemSchema } from './schemas/store-item.schema';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: StoreItem.name, schema: StoreItemSchema }]),
    StorageModule,
  ],
  controllers: [StoreController],
  providers: [StoreService],
  exports: [StoreService],
})
export class StoreModule {}

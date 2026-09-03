import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LevelsService } from './levels.service';
import { LevelsController } from './levels.controller';
import { Level, LevelSchema } from './schemas/level.schema';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Level.name, schema: LevelSchema }]),
    StorageModule,
  ],
  controllers: [LevelsController],
  providers: [LevelsService],
  exports: [LevelsService],
})
export class LevelsModule {}

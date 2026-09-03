import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { SettingsService } from './settings.service';
import { CreateSettingDto } from './dto/create-setting.dto';
import { UpdateSettingDto } from './dto/update-setting.dto';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @UseGuards(AdminAuthGuard)
  @Post('admin')
  create(@Body() createSettingDto: CreateSettingDto) {
    return this.settingsService.create(createSettingDto);
  }

  @UseGuards(AdminAuthGuard)
  @Get('admin')
  findAll() {
    return this.settingsService.findAll();
  }

  // Public endpoint for app config, but optionally protect with JwtAuthGuard
  @Get(':key')
  findOne(@Param('key') key: string) {
    return this.settingsService.findByKey(key);
  }

  @UseGuards(AdminAuthGuard)
  @Patch('admin/:key')
  update(
    @Param('key') key: string,
    @Body() updateSettingDto: UpdateSettingDto,
  ) {
    return this.settingsService.update(key, updateSettingDto);
  }

  @UseGuards(AdminAuthGuard)
  @Delete('admin/:key')
  remove(@Param('key') key: string) {
    return this.settingsService.remove(key);
  }
}

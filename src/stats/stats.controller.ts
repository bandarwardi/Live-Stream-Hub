import { Controller, Get, UseGuards } from '@nestjs/common';
import { StatsService } from './stats.service';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';

@Controller('stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @UseGuards(AdminAuthGuard)
  @Get('admin/dashboard')
  getDashboardStats() {
    return this.statsService.getDashboardStats();
  }
}

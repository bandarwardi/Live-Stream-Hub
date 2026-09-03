import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ReportsService } from './reports.service';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@CurrentUser() user: any, @Body() createReportDto: CreateReportDto) {
    return this.reportsService.create(user.userId, createReportDto);
  }

  @UseGuards(AdminAuthGuard)
  @Get('admin')
  findAllForAdmin(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    const pageNum = parseInt(page || '1', 10);
    const limitNum = parseInt(limit || '20', 10);
    return this.reportsService.findAllForAdmin(pageNum, limitNum, status);
  }

  @UseGuards(AdminAuthGuard)
  @Get('admin/:id')
  findOne(@Param('id') id: string) {
    return this.reportsService.findById(id);
  }

  @UseGuards(AdminAuthGuard)
  @Patch('admin/:id')
  update(
    @Param('id') id: string,
    @Body() updateReportDto: UpdateReportDto,
  ) {
    return this.reportsService.update(id, updateReportDto);
  }
}

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
import { TicketsService } from './tickets.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { ReplyTicketDto } from './dto/reply-ticket.dto';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@CurrentUser() user: any, @Body() createTicketDto: CreateTicketDto) {
    return this.ticketsService.create(user.userId, createTicketDto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('my')
  findMyTickets(@CurrentUser() user: any) {
    return this.ticketsService.findByUserId(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/reply')
  replyAsUser(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() replyDto: ReplyTicketDto,
  ) {
    return this.ticketsService.addReply(id, user.userId, replyDto);
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
    return this.ticketsService.findAllForAdmin(pageNum, limitNum, status);
  }

  @UseGuards(AdminAuthGuard)
  @Get('admin/:id')
  findOne(@Param('id') id: string) {
    return this.ticketsService.findById(id);
  }

  @UseGuards(AdminAuthGuard)
  @Patch('admin/:id')
  update(
    @Param('id') id: string,
    @Body() updateTicketDto: UpdateTicketDto,
  ) {
    return this.ticketsService.update(id, updateTicketDto);
  }

  @UseGuards(AdminAuthGuard)
  @Post('admin/:id/reply')
  replyAsAdmin(
    @CurrentUser() admin: any, // The admin's user document
    @Param('id') id: string,
    @Body() replyDto: ReplyTicketDto,
  ) {
    return this.ticketsService.addReply(id, admin.userId, replyDto);
  }
}

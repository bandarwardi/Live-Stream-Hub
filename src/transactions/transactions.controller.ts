import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UsersService } from '../users/users.service';

@Controller('transactions')
export class TransactionsController {
  constructor(
    private readonly transactionsService: TransactionsService,
    private readonly usersService: UsersService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get('my')
  findMyTransactions(@CurrentUser() user: any) {
    return this.transactionsService.findByUserId(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('recharge')
  async recharge(
    @CurrentUser() user: any,
    @Body() body: { coins: number; price?: string; paymentMethod?: string },
  ) {
    const coins = Number(body.coins);
    if (isNaN(coins) || coins <= 0) {
      throw new BadRequestException('Invalid coin amount');
    }

    const updatedUser = await this.usersService.addCoins(user.userId, coins);
    if (!updatedUser) {
      throw new BadRequestException('User not found');
    }

    const price = body.price || `$${(coins * 0.02).toFixed(2)}`;
    const tx = await this.transactionsService.create({
      user: user.userId,
      amount: coins,
      type: 'deposit',
      description: `Recharge package: ${coins} coins (${price})`,
      status: 'completed',
      referenceId: `rec_${Date.now()}`,
    });

    return {
      success: true,
      message: 'Recharge successful',
      coins: updatedUser.coins,
      diamonds: updatedUser.diamonds,
      transaction: tx,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('convert-diamonds')
  async convertDiamonds(
    @CurrentUser() user: any,
    @Body('diamonds') diamondsToConvert: number,
  ) {
    const diamonds = Number(diamondsToConvert);
    if (isNaN(diamonds) || diamonds <= 0) {
      throw new BadRequestException('Invalid diamonds amount');
    }

    const hasEnough = await this.usersService.deductDiamonds(user.userId, diamonds);
    if (!hasEnough) {
      throw new BadRequestException('Insufficient diamonds balance');
    }

    const coinsToAdd = Math.floor(diamonds * 10);
    const updatedUser = await this.usersService.addCoins(user.userId, coinsToAdd);

    await this.transactionsService.create({
      user: user.userId,
      amount: coinsToAdd,
      type: 'deposit',
      description: `Converted ${diamonds} diamonds to ${coinsToAdd} coins`,
      status: 'completed',
      referenceId: `conv_${Date.now()}`,
    });

    return {
      success: true,
      coins: updatedUser?.coins,
      diamonds: updatedUser?.diamonds,
    };
  }

  @UseGuards(AdminAuthGuard)
  @Get('admin/all')
  findAllForAdmin(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
  ) {
    const pageNum = parseInt(page || '1', 10);
    const limitNum = parseInt(limit || '20', 10);
    return this.transactionsService.findAllForAdmin(pageNum, limitNum, type, status);
  }

  @UseGuards(AdminAuthGuard)
  @Post('admin/adjust')
  async adminAdjustment(@Body() dto: CreateTransactionDto) {
    dto.type = 'admin_adjustment';
    dto.status = 'completed';

    const session = await this.usersService['userModel'].db.startSession();
    session.startTransaction();
    try {
      if (dto.amount > 0) {
        await this.usersService.addCoins(dto.user, dto.amount);
      } else if (dto.amount < 0) {
        // deductCoins returns true on success, false on insufficient funds
        // Since it's admin, maybe we just add negative amount?
        // Let's use addCoins with negative amount for simplicity
        await this.usersService.addCoins(dto.user, dto.amount);
      }
      
      const tx = await this.transactionsService.create(dto);
      await session.commitTransaction();
      return tx;
    } catch (e) {
      await session.abortTransaction();
      throw new BadRequestException('Transaction failed');
    } finally {
      session.endSession();
    }
  }

  @UseGuards(AdminAuthGuard)
  @Patch('admin/:id/status')
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: string,
  ) {
    return this.transactionsService.updateStatus(id, status);
  }
}

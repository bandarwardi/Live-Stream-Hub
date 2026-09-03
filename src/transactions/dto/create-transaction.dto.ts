import { IsString, IsNumber, IsOptional, IsMongoId, IsIn } from 'class-validator';

export class CreateTransactionDto {
  @IsMongoId()
  user: string;

  @IsNumber()
  amount: number;

  @IsString()
  @IsIn([
    'deposit',
    'withdrawal',
    'gift_sent',
    'gift_received',
    'store_purchase',
    'admin_adjustment',
    'other',
  ])
  type: string;

  @IsString()
  @IsOptional()
  referenceId?: string;

  @IsString()
  description: string;

  @IsString()
  @IsOptional()
  @IsIn(['pending', 'completed', 'failed', 'refunded'])
  status?: string;
}

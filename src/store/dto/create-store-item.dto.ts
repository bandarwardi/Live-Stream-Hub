import { IsString, IsNumber, IsOptional, IsBoolean, Min, IsIn } from 'class-validator';

export class CreateStoreItemDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @Min(1)
  price: number;

  @IsNumber()
  @Min(1)
  durationDays: number;

  @IsString()
  @IsIn(['frame', 'entry_effect', 'chat_bubble'])
  type: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

import { IsString, IsNumber, IsOptional, IsBoolean, Min, IsIn } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class CreateStoreItemDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  price: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  durationDays: number;

  @IsString()
  @IsIn(['frame', 'entry_effect', 'chat_bubble'])
  type: string;

  @Transform(({ value }) => value === 'true' || value === true || value === '1' || value === 1)
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsString()
  @IsOptional()
  animationUrl?: string;
}


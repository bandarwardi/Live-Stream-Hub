import { IsString, IsNumber, IsOptional, IsBoolean, Min } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class CreateGiftDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  price: number;

  @Transform(({ value }) => value === 'true' || value === true || value === '1' || value === 1)
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}


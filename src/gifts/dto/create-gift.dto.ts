import { IsString, IsNumber, IsOptional, IsBoolean, Min } from 'class-validator';

export class CreateGiftDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @Min(1)
  price: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

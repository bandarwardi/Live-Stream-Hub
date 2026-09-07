import { IsString, IsNumber, IsOptional, IsBoolean } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class CreateBannerDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  linkUrl?: string;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  sortOrder?: number;

  @Transform(({ value }) => value === 'true' || value === true || value === '1' || value === 1)
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

import { IsString, IsNumber, IsOptional, Min, IsArray } from 'class-validator';

export class CreateLevelDto {
  @IsNumber()
  @Min(1)
  level: number;

  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  emoji?: string;

  @IsNumber()
  @Min(0)
  minXP: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  maxXP?: number;

  @IsString()
  @IsOptional()
  color?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  rewardCoins?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  rewardDiamonds?: number;

  @IsString()
  @IsOptional()
  rewardStoreItem?: string;

  @IsArray()
  @IsOptional()
  perks?: string[];
}


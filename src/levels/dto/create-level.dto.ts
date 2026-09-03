import { IsString, IsNumber, IsOptional, Min } from 'class-validator';

export class CreateLevelDto {
  @IsNumber()
  @Min(1)
  level: number;

  @IsString()
  name: string;

  @IsNumber()
  @Min(0)
  minXP: number;

  @IsString()
  @IsOptional()
  color?: string;
}

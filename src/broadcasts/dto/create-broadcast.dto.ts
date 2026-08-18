import { IsNotEmpty, IsString, MaxLength, IsOptional } from 'class-validator';

export class CreateBroadcastDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  category: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;
}

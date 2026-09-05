import {
  IsNotEmpty,
  IsString,
  MaxLength,
  IsOptional,
  IsNumber,
  IsIn,
} from 'class-validator';

export class CreateVoiceRoomDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  category: string;

  @IsNumber()
  @IsOptional()
  @IsIn([4, 8, 12])
  maxSeats?: number;

  @IsString()
  @IsOptional()
  coverUrl?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;
}

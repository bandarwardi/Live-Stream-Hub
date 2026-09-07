import { IsNotEmpty, IsOptional, IsString, IsObject } from 'class-validator';

export class BroadcastNotificationDto {
  @IsNotEmpty()
  @IsString()
  title: string;

  @IsNotEmpty()
  @IsString()
  message: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, any>;
}

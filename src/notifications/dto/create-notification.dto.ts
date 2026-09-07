import { IsEnum, IsNotEmpty, IsOptional, IsString, IsObject } from 'class-validator';
import { NotificationType } from '../schemas/notification.schema';

export class CreateNotificationDto {
  @IsNotEmpty()
  @IsString()
  recipientId: string;

  @IsOptional()
  @IsString()
  senderId?: string;

  @IsEnum(NotificationType)
  @IsOptional()
  type?: NotificationType;

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

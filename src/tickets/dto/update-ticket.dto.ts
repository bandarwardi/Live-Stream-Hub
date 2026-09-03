import { PartialType } from '@nestjs/mapped-types';
import { CreateTicketDto } from './create-ticket.dto';
import { IsString, IsOptional, IsIn } from 'class-validator';

export class UpdateTicketDto extends PartialType(CreateTicketDto) {
  @IsString()
  @IsOptional()
  @IsIn(['open', 'in_progress', 'closed'])
  status?: string;
}

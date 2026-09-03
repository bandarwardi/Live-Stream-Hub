import { IsString, MaxLength } from 'class-validator';

export class ReplyTicketDto {
  @IsString()
  @MaxLength(2000)
  message: string;
}

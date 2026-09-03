import { IsString, IsOptional, IsIn, MaxLength } from 'class-validator';

export class CreateTicketDto {
  @IsString()
  @MaxLength(200)
  subject: string;

  @IsString()
  @MaxLength(2000)
  message: string;

  @IsString()
  @IsOptional()
  @IsIn(['low', 'medium', 'high'])
  priority?: string;
}

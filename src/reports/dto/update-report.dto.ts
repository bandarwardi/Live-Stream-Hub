import { PartialType } from '@nestjs/mapped-types';
import { CreateReportDto } from './create-report.dto';
import { IsString, IsOptional, IsIn } from 'class-validator';

export class UpdateReportDto extends PartialType(CreateReportDto) {
  @IsString()
  @IsOptional()
  @IsIn(['pending', 'reviewed', 'dismissed'])
  status?: string;

  @IsString()
  @IsOptional()
  actionTaken?: string;
}

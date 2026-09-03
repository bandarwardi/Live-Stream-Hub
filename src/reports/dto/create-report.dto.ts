import { IsString, IsOptional, IsMongoId, IsIn } from 'class-validator';

export class CreateReportDto {
  @IsMongoId()
  @IsOptional()
  reportedUser?: string;

  @IsMongoId()
  @IsOptional()
  reportedBroadcast?: string;

  @IsString()
  reason: string;

  @IsString()
  @IsOptional()
  details?: string;
}

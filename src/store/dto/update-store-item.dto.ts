import { PartialType } from '@nestjs/mapped-types';
import { CreateStoreItemDto } from './create-store-item.dto';

export class UpdateStoreItemDto extends PartialType(CreateStoreItemDto) {}

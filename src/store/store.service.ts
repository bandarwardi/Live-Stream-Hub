import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { StoreItem } from './schemas/store-item.schema';
import { CreateStoreItemDto } from './dto/create-store-item.dto';
import { UpdateStoreItemDto } from './dto/update-store-item.dto';
import { UsersService } from '../users/users.service';

@Injectable()
export class StoreService {
  constructor(
    @InjectModel(StoreItem.name) private storeItemModel: Model<StoreItem>,
    private readonly usersService: UsersService,
  ) {}

  async create(createStoreItemDto: CreateStoreItemDto, imageUrl: string, animationUrl?: string): Promise<StoreItem> {
    const createdItem = new this.storeItemModel({
      ...createStoreItemDto,
      imageUrl,
      animationUrl: animationUrl || createStoreItemDto.animationUrl || null,
    });
    return createdItem.save();
  }

  async findAllForAdmin(): Promise<StoreItem[]> {
    return this.storeItemModel.find().sort({ type: 1, price: 1 }).exec();
  }

  async findAllActive(): Promise<StoreItem[]> {
    return this.storeItemModel.find({ isActive: true }).sort({ type: 1, price: 1 }).exec();
  }

  async findById(id: string): Promise<StoreItem> {
    if (!id || !Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Invalid store item ID: ${id}`);
    }
    const item = await this.storeItemModel.findById(id).exec();
    if (!item) {
      throw new NotFoundException(`StoreItem with ID ${id} not found`);
    }
    return item;
  }

  async findByName(name: string): Promise<StoreItem | null> {
    return this.storeItemModel.findOne({ name }).exec();
  }

  /**
   * Buy a store item: deduct coins from user, add to inventory, optionally grant XP.
   */
  async buyItem(userId: string, itemId: string) {
    const item = await this.findById(itemId);
    if (!item.isActive) {
      throw new BadRequestException('This item is currently unavailable');
    }

    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    // Check if user already owns this item and it hasn't expired
    const existingItem = user.inventory?.find((inv) => {
      if (inv.itemId !== itemId) return false;
      if (!item.durationDays) return true; // permanent
      const expiresAt = new Date(inv.unlockedAt);
      expiresAt.setDate(expiresAt.getDate() + item.durationDays);
      return expiresAt > new Date();
    });
    if (existingItem) {
      throw new BadRequestException('You already own this item');
    }

    // Deduct coins
    const success = await this.usersService.deductCoins(userId, item.price);
    if (!success) {
      throw new ForbiddenException(`Insufficient coins. You need ${item.price} coins.`);
    }

    // Add to inventory
    await this.usersService.addInventoryItem(userId, {
      itemId: item._id.toString(),
      name: item.name,
      type: item.type,
      imageUrl: item.imageUrl,
      animationUrl: item.animationUrl,
      source: 'purchase',
    });

    const updatedUser = await this.usersService.findById(userId);
    return {
      success: true,
      item,
      coins: updatedUser?.coins ?? 0,
      inventory: updatedUser?.inventory ?? [],
    };
  }

  /**
   * Equip a store item (frame, entry_effect, or chat_bubble).
   * The user must already own the item.
   */
  async equipItem(userId: string, itemId: string) {
    const item = await this.findById(itemId);
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    // Check ownership
    const owned = user.inventory?.find((inv) => inv.itemId === itemId);
    if (!owned) {
      throw new ForbiddenException('You do not own this item. Please purchase it first.');
    }

    // Map item type to user field
    const fieldMap: Record<string, string> = {
      frame: 'activeFrame',
      entry_effect: 'activeEntryEffect',
      chat_bubble: 'activeChatBubble',
    };
    const field = fieldMap[item.type];
    if (!field) throw new BadRequestException(`Unknown item type: ${item.type}`);

    const updatePayload: any = { [field]: itemId };
    const updatedUser = await this.usersService.updateProfile(userId, updatePayload);

    return {
      success: true,
      equipped: item.type,
      itemId,
      [field]: itemId,
      user: updatedUser,
    };
  }

  /**
   * Unequip a type of item (frame, entry_effect, or chat_bubble).
   */
  async unequipItem(userId: string, type: 'frame' | 'entry_effect' | 'chat_bubble') {
    const fieldMap: Record<string, string> = {
      frame: 'activeFrame',
      entry_effect: 'activeEntryEffect',
      chat_bubble: 'activeChatBubble',
    };
    const field = fieldMap[type];
    if (!field) throw new BadRequestException(`Unknown type: ${type}`);

    const updatePayload: any = { [field]: null };
    await this.usersService.updateProfile(userId, updatePayload);

    return { success: true, unequipped: type };
  }

  async update(id: string, updateStoreItemDto: UpdateStoreItemDto, imageUrl?: string, animationUrl?: string): Promise<StoreItem> {
    const item = await this.findById(id);
    
    if (updateStoreItemDto.name !== undefined) item.name = updateStoreItemDto.name;
    if (updateStoreItemDto.description !== undefined) item.description = updateStoreItemDto.description;
    if (updateStoreItemDto.price !== undefined) item.price = updateStoreItemDto.price;
    if (updateStoreItemDto.durationDays !== undefined) item.durationDays = updateStoreItemDto.durationDays;
    if (updateStoreItemDto.type !== undefined) item.type = updateStoreItemDto.type;
    if (updateStoreItemDto.isActive !== undefined) item.isActive = updateStoreItemDto.isActive;
    if (imageUrl !== undefined) item.imageUrl = imageUrl;
    if (animationUrl !== undefined) {
      item.animationUrl = animationUrl;
    } else if (updateStoreItemDto.animationUrl !== undefined) {
      item.animationUrl = updateStoreItemDto.animationUrl;
    }

    return item.save();
  }

  async remove(id: string): Promise<void> {
    const result = await this.storeItemModel.deleteOne({ _id: id }).exec();
    if (result.deletedCount === 0) {
      throw new NotFoundException(`StoreItem with ID ${id} not found`);
    }
  }
}


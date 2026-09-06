import { Injectable, NotFoundException, ConflictException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Setting } from './schemas/setting.schema';
import { CreateSettingDto } from './dto/create-setting.dto';
import { UpdateSettingDto } from './dto/update-setting.dto';
import { BRAND } from '../config/brand';

@Injectable()
export class SettingsService implements OnModuleInit {
  constructor(@InjectModel(Setting.name) private settingModel: Model<Setting>) {}

  async onModuleInit() {
    // Seed default economy and coin settings if not present
    const defaultSettings: Array<{ key: string; value: any; description: string }> = [
      {
        key: 'app_name',
        value: BRAND.arabicName,
        description: 'Application official brand name displayed across clients',
      },
      {
        key: 'support_email',
        value: BRAND.supportEmail,
        description: 'Support and contact email for platform inquiries',
      },
      {
        key: 'maintenance_mode',
        value: false,
        description: 'Toggle system maintenance mode for scheduled maintenance',
      },
      {
        key: 'app_fee_percentage',
        value: 30,
        description: 'Platform service fee percentage deducted from gift earnings',
      },
      {
        key: 'diamond_exchange_rate',
        value: 10,
        description: 'Number of coins received for converting 1 diamond',
      },
      {
        key: 'coin_exchange_rate',
        value: 100,
        description: 'Coins per 1 USD for payout/calculations',
      },
      {
        key: 'coin_packages',
        value: [
          { id: 'pkg_1', coins: '100', price: '$1.99', popular: false, badge: 'Starter' },
          { id: 'pkg_2', coins: '500', price: '$7.99', popular: true, badge: 'Best Value' },
          { id: 'pkg_3', coins: '1,200', price: '$14.99', popular: false, badge: 'Popular' },
          { id: 'pkg_4', coins: '2,500', price: '$28.99', popular: false, badge: 'VIP Choice' },
          { id: 'pkg_5', coins: '5,000', price: '$54.99', popular: false, badge: 'Mega Saver' },
          { id: 'pkg_6', coins: '10,000', price: '$99.99', popular: false, badge: 'Ultimate VIP' },
        ],
        description: 'List of coin packages available for purchase in the wallet',
      },
      {
        key: 'terms_of_use',
        value: `مرحباً بكم في منصة ${BRAND.arabicName}. باستخدامك للتطبيق فإنك توافق على الالتزام بكافة الشروط والأحكام ومعايير المجتمع. يحظر نشر أي محتوى ينتهك الآداب العامة أو حقوق الملكية الفكرية.`,
        description: 'Platform terms of use agreement (Arabic & English)',
      },
      {
        key: 'privacy_policy',
        value: `نحن في منصة ${BRAND.shortArabicName} نلتزم بحماية خصوصيتك وأمان بياناتك الشخصية. يتم تشفير كافة المعاملات المالية ومعلومات الحساب وفق أعلى بروتوكولات الأمان العالمية.`,
        description: 'Platform privacy and data protection policy',
      },
      {
        key: 'pk_victory_bonus_percent',
        value: 20,
        description: 'Percentage of winner score awarded as bonus diamonds to PK battle winner',
      },
      {
        key: 'pk_mvp_xp_bonus',
        value: 50,
        description: 'XP awarded to the top gifter on each side at the end of a PK battle',
      },
      {
        key: 'pk_duration_seconds',
        value: 600,
        description: 'Duration of a PK battle in seconds (default 600s / 10 minutes)',
      },
      {
        key: 'pk_streak_rewards',
        value: [
          { streak: 3, diamonds: 50, xp: 100, badge: null, label: 'Hat-trick 🎩' },
          { streak: 5, diamonds: 150, xp: 250, badge: null, label: 'On Fire 🔥' },
          { streak: 10, diamonds: 500, xp: 500, badge: 'pk_legend', label: 'PK Legend 👑' },
        ],
        description: 'Milestone rewards for consecutive PK battle wins',
      },
    ];

    for (const item of defaultSettings) {
      try {
        const exists = await this.settingModel.findOne({ key: item.key });
        if (!exists) {
          await this.settingModel.create(item);
        }
      } catch (err) {
        // Silently continue if DB error on startup
      }
    }
  }

  async create(createSettingDto: CreateSettingDto): Promise<Setting> {
    const existing = await this.settingModel.findOne({ key: createSettingDto.key });
    if (existing) {
      throw new ConflictException(`Setting with key ${createSettingDto.key} already exists`);
    }
    const setting = new this.settingModel(createSettingDto);
    return setting.save();
  }

  async findAll(): Promise<Setting[]> {
    return this.settingModel.find().exec();
  }

  async findByKey(key: string): Promise<Setting> {
    const setting = await this.settingModel.findOne({ key }).exec();
    if (!setting) {
      // Fallback for economy keys if not yet in DB
      if (key === 'diamond_exchange_rate') {
        return { key, value: 10, description: 'Default diamond exchange rate' } as any;
      }
      if (key === 'coin_packages') {
        return {
          key,
          value: [
            { id: 'pkg_1', coins: '100', price: '$1.99', popular: false, badge: null },
            { id: 'pkg_2', coins: '500', price: '$7.99', popular: true, badge: 'Best Value' },
            { id: 'pkg_3', coins: '1,200', price: '$14.99', popular: false, badge: 'Popular' },
            { id: 'pkg_4', coins: '2,500', price: '$28.99', popular: false, badge: 'VIP Choice' },
          ],
          description: 'Default coin packages',
        } as any;
      }
      if (key === 'pk_victory_bonus_percent') {
        return { key, value: 20, description: 'Default PK victory bonus percentage' } as any;
      }
      if (key === 'pk_mvp_xp_bonus') {
        return { key, value: 50, description: 'Default PK MVP XP bonus' } as any;
      }
      if (key === 'pk_streak_rewards') {
        return {
          key,
          value: [
            { streak: 3, diamonds: 50, xp: 100, badge: null, label: 'Hat-trick 🎩' },
            { streak: 5, diamonds: 150, xp: 250, badge: null, label: 'On Fire 🔥' },
            { streak: 10, diamonds: 500, xp: 500, badge: 'pk_legend', label: 'PK Legend 👑' },
          ],
          description: 'Default PK streak rewards',
        } as any;
      }
      throw new NotFoundException(`Setting with key ${key} not found`);
    }
    return setting;
  }

  async update(key: string, updateSettingDto: UpdateSettingDto): Promise<Setting> {
    const setting = await this.settingModel.findOneAndUpdate(
      { key },
      updateSettingDto,
      { new: true }
    ).exec();
    if (!setting) {
      throw new NotFoundException(`Setting with key ${key} not found`);
    }
    return setting;
  }

  async remove(key: string): Promise<void> {
    const result = await this.settingModel.deleteOne({ key }).exec();
    if (result.deletedCount === 0) {
      throw new NotFoundException(`Setting with key ${key} not found`);
    }
  }
}

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// Load environment variables from .env
const envFile = path.resolve(__dirname, '../.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const [key, ...rest] = trimmed.split('=');
    if (key && !process.env[key.trim()]) {
      process.env[key.trim()] = rest.join('=').replace(/^["']|["']$/g, '').trim();
    }
  });
}

const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error('❌ MONGODB_URI is not defined in .env');
  process.exit(1);
}

let brand = {
  name: 'Fox',
  arabicName: 'فوكس | Fox',
  shortArabicName: 'فوكس',
  supportEmail: 'support@fox.live',
};
const brandConfigPath = path.resolve(__dirname, '../../brand.config.json');
if (fs.existsSync(brandConfigPath)) {
  try {
    brand = JSON.parse(fs.readFileSync(brandConfigPath, 'utf8'));
  } catch (e) {}
}

const SEED_SETTINGS = [
  {
    key: 'app_name',
    value: brand.arabicName || 'فوكس | Fox',
    description: 'Application official brand name displayed across clients',
  },
  {
    key: 'support_email',
    value: brand.supportEmail || 'support@fox.live',
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
    key: 'coin_exchange_rate',
    value: 100,
    description: 'Exchange rate: number of coins per 1.00 USD',
  },
  {
    key: 'diamond_exchange_rate',
    value: 10,
    description: 'Diamond conversion rate: coins awarded per 1 diamond converted',
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
    description: 'Available coin recharge packages with pricing and promotional tags',
  },
  {
    key: 'terms_of_use',
    value: `مرحباً بكم في منصة ${brand.arabicName || 'فوكس | Fox'}. باستخدامك للتطبيق فإنك توافق على الالتزام بكافة الشروط والأحكام ومعايير المجتمع. يحظر نشر أي محتوى ينتهك الآداب العامة أو حقوق الملكية الفكرية.`,
    description: 'Platform terms of use agreement (Arabic & English)',
  },
  {
    key: 'privacy_policy',
    value: `نحن في منصة ${brand.shortArabicName || 'فوكس'} نلتزم بحماية خصوصيتك وأمان بياناتك الشخصية. يتم تشفير كافة المعاملات المالية ومعلومات الحساب وفق أعلى بروتوكولات الأمان العالمية.`,
    description: 'Platform privacy and data protection policy',
  },
];

async function seed() {
  console.log('🚀 Connecting to MongoDB...');
  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB successfully.');

  const db = mongoose.connection.db;
  const settingsCol = db.collection('settings');
  const transactionsCol = db.collection('transactions');
  const usersCol = db.collection('users');

  console.log('\n--- 1. Seeding Settings & Economy Config ---');
  let settingsUpserted = 0;
  for (const setting of SEED_SETTINGS) {
    await settingsCol.updateOne(
      { key: setting.key },
      {
        $set: {
          key: setting.key,
          value: setting.value,
          description: setting.description,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );
    settingsUpserted++;
    console.log(`  ✓ Setting upserted: [${setting.key}]`);
  }
  console.log(`🎉 Seeded ${settingsUpserted} settings successfully.`);

  console.log('\n--- 2. Seeding Sample Transaction History for Users ---');
  const users = await usersCol.find({}).limit(10).toArray();

  if (users.length === 0) {
    console.log('⚠️ No users found in database yet. Transactions will be created as users register.');
  } else {
    let totalTxsCreated = 0;
    for (const user of users) {
      const existingTxsCount = await transactionsCol.countDocuments({ user: user._id });
      if (existingTxsCount < 4) {
        const now = Date.now();
        const sampleTxs = [
          {
            user: user._id,
            amount: 1200,
            type: 'deposit',
            description: 'Recharge package: 1,200 coins ($14.99)',
            referenceId: `rec_${now - 1000 * 60 * 60 * 24 * 2}`,
            status: 'completed',
            createdAt: new Date(now - 1000 * 60 * 60 * 24 * 2), // 2 days ago
            updatedAt: new Date(now - 1000 * 60 * 60 * 24 * 2),
          },
          {
            user: user._id,
            amount: -120,
            type: 'gift_sent',
            description: 'Sent Crown 👑 gift in live broadcast',
            referenceId: `gift_${now - 1000 * 60 * 60 * 20}`,
            status: 'completed',
            createdAt: new Date(now - 1000 * 60 * 60 * 20), // 20 hours ago
            updatedAt: new Date(now - 1000 * 60 * 60 * 20),
          },
          {
            user: user._id,
            amount: 50,
            type: 'admin_adjustment',
            description: 'Daily check-in reward bonus',
            referenceId: `bonus_${now - 1000 * 60 * 60 * 8}`,
            status: 'completed',
            createdAt: new Date(now - 1000 * 60 * 60 * 8), // 8 hours ago
            updatedAt: new Date(now - 1000 * 60 * 60 * 8),
          },
          {
            user: user._id,
            amount: 500,
            type: 'deposit',
            description: 'Converted 50 diamonds to 500 coins',
            referenceId: `conv_${now - 1000 * 60 * 60 * 2}`,
            status: 'completed',
            createdAt: new Date(now - 1000 * 60 * 60 * 2), // 2 hours ago
            updatedAt: new Date(now - 1000 * 60 * 60 * 2),
          },
          {
            user: user._id,
            amount: -10,
            type: 'gift_sent',
            description: 'Sent Rose 🌹 gift in private room',
            referenceId: `gift_${now - 1000 * 60 * 15}`,
            status: 'completed',
            createdAt: new Date(now - 1000 * 60 * 15), // 15 mins ago
            updatedAt: new Date(now - 1000 * 60 * 15),
          },
        ];

        await transactionsCol.insertMany(sampleTxs);
        totalTxsCreated += sampleTxs.length;
        console.log(`  ✓ Added ${sampleTxs.length} seed transactions for user: [${user.username || user._id}]`);
      } else {
        console.log(`  ℹ User [${user.username || user._id}] already has ${existingTxsCount} transactions.`);
      }
    }
    console.log(`🎉 Created ${totalTxsCreated} seed transactions.`);
  }

  console.log('\n🌟 ALL SEED DATA APPLIED SUCCESSFULLY!\n');
  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ Error during seeding:', err);
  process.exit(1);
});

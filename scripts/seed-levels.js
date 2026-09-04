const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// 1. Load environment variables from nestjs/.env
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

const s3Client = new S3Client({
  region: process.env.S3_REGION || 'auto',
  endpoint: process.env.S3_ENDPOINT || 'https://t3.storageapi.dev',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
  forcePathStyle: true,
});

const uri = process.env.MONGODB_URI;
const baseUrl = process.env.API_URL || 'https://live-stream-hub-production.up.railway.app';
const bucket = process.env.S3_BUCKET || 'buffered-bucket-h822q0pxn';
const levelsLocalDir = path.resolve(__dirname, '../../admin/public/assets/levels');

if (!fs.existsSync(levelsLocalDir)) {
  fs.mkdirSync(levelsLocalDir, { recursive: true });
}

// 2. Definition of 30 Levels
const LEVELS_CATALOG = [
  {
    level: 1,
    name: 'Seedling | بذرة',
    emoji: '🌱',
    minXP: 0,
    maxXP: 99,
    color: '#9E9E9E',
    rewardCoins: 0,
    rewardDiamonds: 0,
    rewardStoreItem: null,
    perks: ['بدء المشوار في ستريم زون'],
    iconPath: 'Seedling/3D/seedling_3d.png',
  },
  {
    level: 2,
    name: 'Sprout | برعم',
    emoji: '🌿',
    minXP: 100,
    maxXP: 299,
    color: '#78909C',
    rewardCoins: 50,
    rewardDiamonds: 5,
    rewardStoreItem: null,
    perks: ['تفاعل في الشات مع شارة المستوى'],
    iconPath: 'Herb/3D/herb_3d.png',
  },
  {
    level: 3,
    name: 'Bud | زهرة ناشئة',
    emoji: '🌸',
    minXP: 300,
    maxXP: 599,
    color: '#26A69A',
    rewardCoins: 100,
    rewardDiamonds: 10,
    rewardStoreItem: null,
    perks: ['ظهور ملون في قائمة المشاهدين'],
    iconPath: 'Cherry%20blossom/3D/cherry_blossom_3d.png',
  },
  {
    level: 4,
    name: 'Bloom | إزهار',
    emoji: '🌼',
    minXP: 600,
    maxXP: 999,
    color: '#29B6F6',
    rewardCoins: 150,
    rewardDiamonds: 15,
    rewardStoreItem: null,
    perks: ['إمكانية إرسال هدايا كومبو'],
    iconPath: 'Blossom/3D/blossom_3d.png',
  },
  {
    level: 5,
    name: 'Newcomer Star | نجم صاعد',
    emoji: '⭐',
    minXP: 1000,
    maxXP: 1999,
    color: '#42A5F5',
    rewardCoins: 300,
    rewardDiamonds: 30,
    rewardStoreItem: 'Sakura Blossom Frame',
    perks: ['إطار زهور الساكورا مجاناً', 'شارة النجم الصاعد'],
    iconPath: 'Glowing%20star/3D/glowing_star_3d.png',
  },
  {
    level: 6,
    name: 'Rising | متألق',
    emoji: '📈',
    minXP: 2000,
    maxXP: 3499,
    color: '#5C6BC0',
    rewardCoins: 300,
    rewardDiamonds: 35,
    rewardStoreItem: null,
    perks: ['زيادة سرعة الحصول على نقاط التفاعل'],
    iconPath: 'Chart%20increasing/3D/chart_increasing_3d.png',
  },
  {
    level: 7,
    name: 'Spark | وميض',
    emoji: '✨',
    minXP: 3500,
    maxXP: 5499,
    color: '#7E57C2',
    rewardCoins: 400,
    rewardDiamonds: 40,
    rewardStoreItem: null,
    perks: ['تأثير وميض عند دخول البث'],
    iconPath: 'Sparkles/3D/sparkles_3d.png',
  },
  {
    level: 8,
    name: 'Glitter | بريق',
    emoji: '💫',
    minXP: 5500,
    maxXP: 7999,
    color: '#AB47BC',
    rewardCoins: 500,
    rewardDiamonds: 50,
    rewardStoreItem: null,
    perks: ['لون مخصص لاسم المستخدم في الغرفة'],
    iconPath: 'Dizzy/3D/dizzy_3d.png',
  },
  {
    level: 9,
    name: 'Shine | إشراق',
    emoji: '🔆',
    minXP: 8000,
    maxXP: 11999,
    color: '#EC407A',
    rewardCoins: 600,
    rewardDiamonds: 60,
    rewardStoreItem: null,
    perks: ['أولوية في ترتيب قائمة الداعمين'],
    iconPath: 'Sun/3D/sun_3d.png',
  },
  {
    level: 10,
    name: 'Active Streamer | نشط متحمّس',
    emoji: '🔥',
    minXP: 12000,
    maxXP: 19999,
    color: '#EF5350',
    rewardCoins: 1000,
    rewardDiamonds: 100,
    rewardStoreItem: 'Neon Glow Bubble',
    perks: ['فقاعة محادثة النيون المتوهجة', 'شارة اللهب النشط'],
    iconPath: 'Fire/3D/fire_3d.png',
  },
  {
    level: 11,
    name: 'Talent | موهوب',
    emoji: '🎭',
    minXP: 20000,
    maxXP: 29999,
    color: '#FF7043',
    rewardCoins: 800,
    rewardDiamonds: 80,
    rewardStoreItem: null,
    perks: ['إمكانية إنشاء بث مشترك مع 4 مقاعد'],
    iconPath: 'Performing%20arts/3D/performing_arts_3d.png',
  },
  {
    level: 12,
    name: 'Creator | صانع محتوى',
    emoji: '🎨',
    minXP: 30000,
    maxXP: 44999,
    color: '#FFA726',
    rewardCoins: 1000,
    rewardDiamonds: 100,
    rewardStoreItem: null,
    perks: ['أداة تخصيص خلفية البث'],
    iconPath: 'Artist%20palette/3D/artist_palette_3d.png',
  },
  {
    level: 13,
    name: 'Influence | مؤثر',
    emoji: '💡',
    minXP: 45000,
    maxXP: 64999,
    color: '#FFCA28',
    rewardCoins: 1200,
    rewardDiamonds: 120,
    rewardStoreItem: null,
    perks: ['تثبيت الرسائل في الشات لمدة دقيقة'],
    iconPath: 'Light%20bulb/3D/light_bulb_3d.png',
  },
  {
    level: 14,
    name: 'Vibrant | ساطع',
    emoji: '🌈',
    minXP: 65000,
    maxXP: 89999,
    color: '#D4E157',
    rewardCoins: 1500,
    rewardDiamonds: 150,
    rewardStoreItem: null,
    perks: ['رسائل صوتية أطول في المحادثات'],
    iconPath: 'Rainbow/3D/rainbow_3d.png',
  },
  {
    level: 15,
    name: 'Super Star | سوبر ستار',
    emoji: '⭐',
    minXP: 90000,
    maxXP: 124999,
    color: '#66BB6A',
    rewardCoins: 2500,
    rewardDiamonds: 250,
    rewardStoreItem: 'Cyber Neon Frame',
    perks: ['إطار السايبر النيون المجاني', 'شارة السوبر ستار المضيئة'],
    iconPath: 'Star/3D/star_3d.png',
  },
  {
    level: 16,
    name: 'Elite | نخبة',
    emoji: '💎',
    minXP: 125000,
    maxXP: 174999,
    color: '#26C6DA',
    rewardCoins: 2000,
    rewardDiamonds: 200,
    rewardStoreItem: null,
    perks: ['صوت مخصص عند إرسال الهدايا'],
    iconPath: 'Gem%20stone/3D/gem_stone_3d.png',
  },
  {
    level: 17,
    name: 'Prestige | مكانة مرموقة',
    emoji: '🏆',
    minXP: 175000,
    maxXP: 239999,
    color: '#42A5F5',
    rewardCoins: 2500,
    rewardDiamonds: 250,
    rewardStoreItem: null,
    perks: ['إبراز الحساب في قائمة الاكتشاف'],
    iconPath: 'Trophy/3D/trophy_3d.png',
  },
  {
    level: 18,
    name: 'Champion | بطل',
    emoji: '🥇',
    minXP: 240000,
    maxXP: 324999,
    color: '#5C6BC0',
    rewardCoins: 3000,
    rewardDiamonds: 300,
    rewardStoreItem: null,
    perks: ['شارة بطل المنصة'],
    iconPath: '1st%20place%20medal/3D/1st_place_medal_3d.png',
  },
  {
    level: 19,
    name: 'Master | أستاذ',
    emoji: '🔮',
    minXP: 325000,
    maxXP: 449999,
    color: '#7E57C2',
    rewardCoins: 3500,
    rewardDiamonds: 350,
    rewardStoreItem: null,
    perks: ['حماية من الكتم العادي في البث'],
    iconPath: 'Crystal%20ball/3D/crystal_ball_3d.png',
  },
  {
    level: 20,
    name: 'VIP Royal Crown | رتبة التاج الملكي',
    emoji: '👑',
    minXP: 450000,
    maxXP: 599999,
    color: '#FFD700',
    rewardCoins: 5000,
    rewardDiamonds: 500,
    rewardStoreItem: 'Royal Gold Frame',
    perks: ['إطار الذهب الملكي الفاخر', 'شارة التاج الذهبي الدائمة', 'دخول متميز للغرف'],
    iconPath: 'Crown/3D/crown_3d.png',
  },
  {
    level: 21,
    name: 'Legend | أسطورة',
    emoji: '🌟',
    minXP: 600000,
    maxXP: 799999,
    color: '#FF8F00',
    rewardCoins: 4000,
    rewardDiamonds: 400,
    rewardStoreItem: null,
    perks: ['تأثير النيزك الساقط عند الدخول'],
    iconPath: 'Shooting%20star/3D/shooting_star_3d.png',
  },
  {
    level: 22,
    name: 'Mythic | خيالي مهيب',
    emoji: '🦁',
    minXP: 800000,
    maxXP: 1049999,
    color: '#E65100',
    rewardCoins: 4500,
    rewardDiamonds: 450,
    rewardStoreItem: null,
    perks: ['تأثير زئير الأسد في التفاعل'],
    iconPath: 'Lion/3D/lion_3d.png',
  },
  {
    level: 23,
    name: 'Titan | عملاق خارق',
    emoji: '⚡',
    minXP: 1050000,
    maxXP: 1349999,
    color: '#BF360C',
    rewardCoins: 5000,
    rewardDiamonds: 500,
    rewardStoreItem: null,
    perks: ['مؤثرات صاعقة البرق في الشات'],
    iconPath: 'High%20voltage/3D/high_voltage_3d.png',
  },
  {
    level: 24,
    name: 'Sage | حكيم الصدارة',
    emoji: '🧿',
    minXP: 1350000,
    maxXP: 1749999,
    color: '#880E4F',
    rewardCoins: 6000,
    rewardDiamonds: 600,
    rewardStoreItem: null,
    perks: ['حضور خاص في لوحة الشرف'],
    iconPath: 'Nazar%20amulet/3D/nazar_amulet_3d.png',
  },
  {
    level: 25,
    name: 'Blazing Flame | اللهب المتفجر',
    emoji: '💥',
    minXP: 1750000,
    maxXP: 2249999,
    color: '#D81B60',
    rewardCoins: 8000,
    rewardDiamonds: 800,
    rewardStoreItem: 'Blazing Flame Frame',
    perks: ['إطار اللهب الحارق الدائم', 'تأثير انفجار ناري عند إرسال الهدايا'],
    iconPath: 'Collision/3D/collision_3d.png',
  },
  {
    level: 26,
    name: 'Diamond | ألماسي',
    emoji: '💠',
    minXP: 2250000,
    maxXP: 2999999,
    color: '#00BCD4',
    rewardCoins: 7000,
    rewardDiamonds: 700,
    rewardStoreItem: null,
    perks: ['حساب موثق تلقائياً بشارة الألماس'],
    iconPath: 'Diamond%20with%20a%20dot/3D/diamond_with_a_dot_3d.png',
  },
  {
    level: 27,
    name: 'Celestial | كوني سماوي',
    emoji: '🌙',
    minXP: 3000000,
    maxXP: 3999999,
    color: '#0D47A1',
    rewardCoins: 8000,
    rewardDiamonds: 800,
    rewardStoreItem: null,
    perks: ['مؤثر الهلال الكوني المحيط بالملف الشخصي'],
    iconPath: 'Crescent%20moon/3D/crescent_moon_3d.png',
  },
  {
    level: 28,
    name: 'Phoenix | العنقاء الخالدة',
    emoji: '🦅',
    minXP: 4000000,
    maxXP: 5499999,
    color: '#B71C1C',
    rewardCoins: 10000,
    rewardDiamonds: 1000,
    rewardStoreItem: null,
    perks: ['رمز العنقاء الأسطوري بجانب الاسم في كل مكان'],
    iconPath: 'Eagle/3D/eagle_3d.png',
  },
  {
    level: 29,
    name: 'Immortal | خالد كوكبي',
    emoji: '🪐',
    minXP: 5500000,
    maxXP: 7499999,
    color: '#1A237E',
    rewardCoins: 12000,
    rewardDiamonds: 1200,
    rewardStoreItem: null,
    perks: ['مدخل فضائي مداري كامل الشاشة عند الدخول'],
    iconPath: 'Ringed%20planet/3D/ringed_planet_3d.png',
  },
  {
    level: 30,
    name: 'Galaxy Emperor | إمبراطور المجرة',
    emoji: '🌌',
    minXP: 7500000,
    maxXP: 999999999,
    color: '#6A0DAD',
    rewardCoins: 25000,
    rewardDiamonds: 2500,
    rewardStoreItem: 'Cosmic Galaxy Frame',
    perks: [
      'إطار المجرة الكونية الأسطوري',
      'مؤثر دخول السوبركار VIP فائق الفخامة',
      'إشعار عام لكامل المنصة عند دخول أي بث',
      'شارة إمبراطور المجرة الملكية'
    ],
    iconPath: 'Milky%20way/3D/milky_way_3d.png',
  }
];

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function seed() {
  console.log('🚀 Starting User Levels Seeding (30 Levels)...');
  console.log('Connecting to MongoDB...');
  await mongoose.connect(uri);
  const levelsCol = mongoose.connection.db.collection('levels');

  let uploaded = 0;
  let inserted = 0;

  for (const item of LEVELS_CATALOG) {
    const localFilename = `level_${item.level}.png`;
    const localFile = path.join(levelsLocalDir, localFilename);
    const remoteUrl = `https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/${item.iconPath}`;

    let fileBuffer;
    if (fs.existsSync(localFile)) {
      fileBuffer = fs.readFileSync(localFile);
    } else {
      process.stdout.write(`Downloading 3D badge for Level ${item.level}... `);
      fileBuffer = await fetchBuffer(remoteUrl);
      fs.writeFileSync(localFile, fileBuffer);
      console.log(`Saved locally.`);
    }

    const s3Key = `levels/${localFilename}`;

    // 1. Upload badge to S3
    await s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: fileBuffer,
      ContentType: 'image/png'
    }));
    uploaded++;

    const badgeUrl = `${baseUrl}/storage/${s3Key}`;

    // 2. Upsert into MongoDB
    await levelsCol.updateOne(
      { level: item.level },
      {
        $set: {
          level: item.level,
          name: item.name,
          emoji: item.emoji,
          minXP: item.minXP,
          maxXP: item.maxXP,
          color: item.color,
          badgeUrl: badgeUrl,
          rewardCoins: item.rewardCoins,
          rewardDiamonds: item.rewardDiamonds,
          rewardStoreItem: item.rewardStoreItem,
          perks: item.perks,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          createdAt: new Date()
        }
      },
      { upsert: true }
    );
    inserted++;

    const rewardDetails = [];
    if (item.rewardCoins) rewardDetails.push(`🪙 +${item.rewardCoins}`);
    if (item.rewardDiamonds) rewardDetails.push(`💎 +${item.rewardDiamonds}`);
    if (item.rewardStoreItem) rewardDetails.push(`🎁 [ITEM: ${item.rewardStoreItem}]`);

    console.log(
      `[${inserted}/30] Level ${item.level}: ${item.emoji} ${item.name} (${item.minXP.toLocaleString()} XP) | Rewards: ${rewardDetails.join(', ') || 'None'}`
    );
  }

  const totalInDb = await levelsCol.countDocuments();
  console.log(`\n🎉 30 LEVELS SEED COMPLETED SUCCESSFULLY!`);
  console.log(`Total 3D Badges uploaded to S3: ${uploaded}`);
  console.log(`Total Levels verified in MongoDB: ${totalInDb}`);

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch(err => {
  console.error('❌ Error during levels seeding:', err);
  process.exit(1);
});

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

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
const giftsDir = path.resolve(__dirname, '../../admin/public/assets/gifts');

// Read presets from gift-presets.ts
const presetsFilePath = path.resolve(__dirname, '../../admin/src/lib/gift-presets.ts');
const presetsFile = fs.readFileSync(presetsFilePath, 'utf8');
const match = presetsFile.match(/export const DEFAULT_GIFT_PRESETS: GiftPreset\[] = (\[[\s\S]*?\]);/);

if (!match) {
  console.error('Could not extract presets');
  process.exit(1);
}

// Evaluate presets safely
const DEFAULT_GIFT_PRESETS = eval(match[1]);
console.log(`Loaded ${DEFAULT_GIFT_PRESETS.length} presets from catalog.`);

async function seed() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(uri);
  const giftsCol = mongoose.connection.db.collection('gifts');

  let uploaded = 0;
  let inserted = 0;

  for (const preset of DEFAULT_GIFT_PRESETS) {
    const localFile = path.join(giftsDir, path.basename(preset.image));
    if (!fs.existsSync(localFile)) {
      console.warn('Local file missing:', localFile);
      continue;
    }

    const fileBuffer = fs.readFileSync(localFile);
    const s3Key = 'gifts/' + preset.id + '.png';

    // 1. Upload to S3
    await s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: fileBuffer,
      ContentType: 'image/png'
    }));
    uploaded++;

    const imageUrl = `${baseUrl}/storage/${s3Key}`;

    // 2. Upsert into MongoDB
    await giftsCol.updateOne(
      { name: preset.name },
      {
        $set: {
          name: preset.name,
          description: preset.description,
          price: preset.price,
          imageUrl: imageUrl,
          animationUrl: null,
          isActive: true,
          updatedAt: new Date()
        },
        $setOnInsert: {
          createdAt: new Date()
        }
      },
      { upsert: true }
    );
    inserted++;
    console.log(`[${inserted}/${DEFAULT_GIFT_PRESETS.length}] Uploaded & Saved: ${preset.name} (${preset.price} coins)`);
  }

  const totalInDb = await giftsCol.countDocuments();
  console.log(`\n🎉 SEED FINISHED SUCCESSFULLY!`);
  console.log(`Total gifts uploaded to S3: ${uploaded}`);
  console.log(`Total gifts saved in MongoDB: ${totalInDb}`);
  await mongoose.disconnect();
  process.exit(0);
}

seed().catch(err => {
  console.error('Error during seeding:', err);
  process.exit(1);
});

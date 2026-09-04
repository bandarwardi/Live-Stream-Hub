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
const storeDir = path.resolve(__dirname, '../../admin/public/assets/store');

// Read presets from store-presets.ts
const presetsFilePath = path.resolve(__dirname, '../../admin/src/lib/store-presets.ts');
const presetsFile = fs.readFileSync(presetsFilePath, 'utf8');
const match = presetsFile.match(/export const DEFAULT_STORE_PRESETS: StorePreset\[] = (\[[\s\S]*?\]);/);

if (!match) {
  console.error('Could not extract store presets');
  process.exit(1);
}

const DEFAULT_STORE_PRESETS = eval(match[1]);
console.log(`Loaded ${DEFAULT_STORE_PRESETS.length} store presets from catalog.`);

async function seed() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(uri);
  const storeCol = mongoose.connection.db.collection('storeitems');

  let uploaded = 0;
  let inserted = 0;

  for (const preset of DEFAULT_STORE_PRESETS) {
    const localFilename = path.basename(preset.image);
    const localFile = path.join(storeDir, localFilename);
    if (!fs.existsSync(localFile)) {
      console.warn('Local file missing:', localFile);
      continue;
    }

    const fileBuffer = fs.readFileSync(localFile);
    const ext = path.extname(localFilename);
    const contentType = ext === '.svg' ? 'image/svg+xml' : 'image/png';
    const s3Key = `store/${preset.id}${ext}`;

    // 1. Upload Image to S3
    await s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: fileBuffer,
      ContentType: contentType
    }));
    uploaded++;

    const imageUrl = `${baseUrl}/storage/${s3Key}`;

    // 2. Upload Animation to S3 if present
    let animationUrl = null;
    if (preset.animation) {
      const animFilename = path.basename(preset.animation);
      const localAnimFile = path.join(storeDir, 'animations', animFilename);
      if (fs.existsSync(localAnimFile)) {
        const animBuffer = fs.readFileSync(localAnimFile);
        const animKey = `store/animations/${preset.id}.webp`;
        await s3Client.send(new PutObjectCommand({
          Bucket: bucket,
          Key: animKey,
          Body: animBuffer,
          ContentType: 'image/webp'
        }));
        animationUrl = `${baseUrl}/storage/${animKey}`;
        uploaded++;
      }
    }

    // 3. Upsert into MongoDB
    await storeCol.updateOne(
      { name: preset.name },
      {
        $set: {
          name: preset.name,
          description: preset.description,
          price: preset.price,
          durationDays: preset.durationDays,
          type: preset.type,
          imageUrl: imageUrl,
          animationUrl: animationUrl,
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
    console.log(`[${inserted}/${DEFAULT_STORE_PRESETS.length}] (${preset.type}) Saved: ${preset.name} (${preset.price} coins) ${animationUrl ? '✨ [ANIMATED]' : ''}`);
  }

  const totalInDb = await storeCol.countDocuments();
  console.log(`\n🎉 STORE SEED FINISHED SUCCESSFULLY!`);
  console.log(`Total store items uploaded to S3: ${uploaded}`);
  console.log(`Total store items saved in MongoDB: ${totalInDb}`);
  await mongoose.disconnect();
  process.exit(0);
}

seed().catch(err => {
  console.error('Error during store seeding:', err);
  process.exit(1);
});

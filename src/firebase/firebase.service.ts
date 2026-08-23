import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { initializeApp, cert, getApps, getApp, App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private firebaseApp: App;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID');
    const serviceAccountKeyString = this.configService.get<string>('FIREBASE_SERVICE_ACCOUNT_KEY');

    if (!projectId || !serviceAccountKeyString) {
      console.warn('Firebase credentials not found. Firebase Admin SDK will not be initialized.');
      return;
    }

    try {
      let serviceAccount;
      let cleanedKey = serviceAccountKeyString.trim();
      if (cleanedKey.startsWith("'") && cleanedKey.endsWith("'")) {
        cleanedKey = cleanedKey.slice(1, -1);
      }
      if (cleanedKey.startsWith('{')) {
        serviceAccount = JSON.parse(cleanedKey);
      } else if (cleanedKey.startsWith('"')) {
        // Handle double escaped JSON string
        const unescaped = cleanedKey

          .replace(/^"|"$/g, '')          // Remove surrounding quotes
          .replace(/\\"/g, '"')           // Unescape quotes
          .replace(/\\\\n/g, '\\n')       // Fix double escaped newlines
          .replace(/(?<!\\)\\n/g, '\\n'); // Ensure single escaped newlines become valid JSON newlines
        serviceAccount = JSON.parse(unescaped);
      } else {
        // Base64 fallback (industry standard for Firebase keys in .env)
        const decoded = Buffer.from(cleanedKey, 'base64').toString('utf8');
        serviceAccount = JSON.parse(decoded);
      }
      
      // Prevent initializing multiple times if module is reloaded
      if (!getApps().length) {
        this.firebaseApp = initializeApp({
          credential: cert(serviceAccount),
          projectId,
        });
        console.log('Firebase Admin initialized successfully.');
      } else {
        this.firebaseApp = getApp();
      }
    } catch (error) {
      console.error('Error initializing Firebase Admin:', error);
    }
  }

  getAuth() {
    return getAuth(this.firebaseApp);
  }
}

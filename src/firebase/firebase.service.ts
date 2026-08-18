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
      const serviceAccount = JSON.parse(serviceAccountKeyString);
      
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

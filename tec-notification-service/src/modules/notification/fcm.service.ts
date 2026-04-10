import { Injectable, Logger } from '@nestjs/common';
import * as admin              from 'firebase-admin';

@Injectable()
export class FcmService {
  private readonly logger = new Logger(FcmService.name);
  private readonly app: admin.app.App | null = null;

  constructor() {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccount) {
      this.logger.warn('FIREBASE_SERVICE_ACCOUNT not set — FCM disabled');
      return;
    }

    try {
      if (admin.apps.length === 0) {
        this.app = admin.initializeApp({
          credential: admin.credential.cert(
            JSON.parse(serviceAccount) as admin.ServiceAccount
          ),
        });
        this.logger.log('✅ Firebase Admin initialised');
      } else {
        this.app = admin.apps[0]!;
      }
    } catch (err: unknown) {
      this.logger.error('Firebase init failed', (err as Error).message);
    }
  }

  async sendToToken(
    token:  string,
    title:  string,
    body:   string,
    data?:  Record<string, string>,
  ): Promise<boolean> {
    if (!this.app) return false;

    try {
      await admin.messaging(this.app).send({
        token,
        notification: { title, body },
        data:         data ?? {},
        android:      { priority: 'high' },
        apns:         { payload: { aps: { sound: 'default' } } },
      });
      this.logger.log(`FCM sent to token: ${token.slice(0, 20)}...`);
      return true;
    } catch (err: unknown) {
      const fcmErr = err as { code?: string; message?: string };
      if (
        fcmErr.code === 'messaging/registration-token-not-registered' ||
        fcmErr.code === 'messaging/invalid-registration-token'
      ) {
        this.logger.warn(`FCM token expired — should be removed: ${token.slice(0, 20)}`);
        return false;
      }
      this.logger.error(`FCM send failed: ${fcmErr.message}`);
      return false;
    }
  }

  async sendToTokens(
    tokens: string[],
    title:  string,
    body:   string,
    data?:  Record<string, string>,
  ): Promise<{ success: number; failed: number }> {
    if (!this.app || tokens.length === 0) return { success: 0, failed: 0 };

    try {
      const response = await admin.messaging(this.app).sendEachForMulticast({
        tokens,
        notification: { title, body },
        data:         data ?? {},
        android:      { priority: 'high' },
        apns:         { payload: { aps: { sound: 'default' } } },
      });

      this.logger.log(
        `FCM multicast: ${response.successCount} success, ${response.failureCount} failed`
      );

      return { success: response.successCount, failed: response.failureCount };
    } catch (err: unknown) {
      this.logger.error(`FCM multicast failed: ${(err as Error).message}`);
      return { success: 0, failed: tokens.length };
    }
  }

  get isEnabled(): boolean {
    return this.app !== null;
  }
    }

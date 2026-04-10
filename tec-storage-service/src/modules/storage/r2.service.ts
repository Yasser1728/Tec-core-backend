import { Injectable }     from '@nestjs/common';
import pino               from 'pino';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl }   from '@aws-sdk/s3-request-presigner';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', base: { service: 'storage-service' } });

@Injectable()
export class R2Service {
  private readonly client:   S3Client;
  private readonly bucket:   string;
  private readonly endpoint: string;

  constructor() {
    this.bucket   = process.env.R2_BUCKET_NAME ?? 'tec-storage';
    this.endpoint = process.env.R2_ENDPOINT    ?? '';

    this.client = new S3Client({
      region:      'auto',
      endpoint:    this.endpoint,
      credentials: {
        accessKeyId:     process.env.R2_ACCESS_KEY_ID     ?? '',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
      },
    });

    logger.info('[R2Service] Initialized');
  }

  async getUploadUrl(key: string, mimeType: string, expiresIn = 300): Promise<string> {
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: mimeType });
    return getSignedUrl(this.client, command, { expiresIn });
  }

  async getDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn });
  }

  async deleteFile(key: string): Promise<void> {
    const command = new DeleteObjectCommand({ Bucket: this.bucket, Key: key });
    await this.client.send(command);
    logger.info({ key }, '[R2Service] Deleted');
  }
}

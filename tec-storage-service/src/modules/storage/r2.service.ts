import { Injectable } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class R2Service {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly endpoint: string;

  constructor() {
    this.bucket = process.env.R2_BUCKET_NAME ?? 'tec-storage';
    this.endpoint = process.env.R2_ENDPOINT ?? '';

    this.client = new S3Client({
      region: 'auto',
      endpoint: this.endpoint,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
      },
    });

    console.log('[R2Service] Initialized');
  }

  // ✅ Generate signed URL for direct upload
  async getUploadUrl(
    key: string,
    mimeType: string,
    expiresIn = 300, // 5 minutes
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mimeType,
    });

    return getSignedUrl(this.client, command, { expiresIn });
  }

  // ✅ Generate signed URL for download
  async getDownloadUrl(
    key: string,
    expiresIn = 3600, // 1 hour
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return getSignedUrl(this.client, command, { expiresIn });
  }

  // ✅ Delete file
  async deleteFile(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    await this.client.send(command);
    console.log(`[R2Service] Deleted: ${key}`);
  }
}

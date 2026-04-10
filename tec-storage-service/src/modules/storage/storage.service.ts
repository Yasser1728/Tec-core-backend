import { Injectable, NotFoundException } from '@nestjs/common';
import { Logger }                         from '@nestjs/common';
import { PrismaService }                  from '../../prisma/prisma.service';
import { R2Service }                      from './r2.service';
import { v4 as uuidv4 }                  from 'uuid';

export type FileTypeEnum = 'IMAGE' | 'DOCUMENT' | 'VIDEO' | 'AUDIO' | 'OTHER';

const getMimeFileType = (mimeType: string): FileTypeEnum => {
  if (mimeType.startsWith('image/')) return 'IMAGE';
  if (mimeType.startsWith('video/')) return 'VIDEO';
  if (mimeType.startsWith('audio/')) return 'AUDIO';
  if (
    mimeType === 'application/pdf' ||
    mimeType.includes('document') ||
    mimeType.includes('text/')
  ) return 'DOCUMENT';
  return 'OTHER';
};

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2:     R2Service,
  ) {}

  async getUploadUrl(data: {
    userId:    string;
    filename:  string;
    mimeType:  string;
    size:      number;
    folder?:   string;
  }) {
    const MAX_SIZE = 10 * 1024 * 1024;
    if (data.size > MAX_SIZE) {
      throw new Error('File size exceeds 10MB limit');
    }

    const ALLOWED_TYPES = [
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'application/pdf',
      'video/mp4',
      'audio/mpeg',
    ];

    if (!ALLOWED_TYPES.includes(data.mimeType)) {
      throw new Error(`File type ${data.mimeType} is not allowed`);
    }

    const fileId  = uuidv4();
    const ext     = data.filename.split('.').pop();
    const folder  = data.folder ?? 'uploads';
    const key     = `${folder}/${data.userId}/${fileId}.${ext}`;
    const uploadUrl = await this.r2.getUploadUrl(key, data.mimeType);

    return { uploadUrl, key, fileId };
  }

  async saveFile(data: {
    userId:    string;
    key:       string;
    filename:  string;
    mimeType:  string;
    size:      number;
    metadata?: Record<string, unknown>;
  }) {
    const endpoint = process.env.R2_ENDPOINT    ?? '';
    const bucket   = process.env.R2_BUCKET_NAME ?? 'tec-storage';
    const url      = `${endpoint}/${bucket}/${data.key}`;

    const file = await this.prisma.file.create({
      data: {
        user_id:   data.userId,
        key:       data.key,
        url,
        filename:  data.filename,
        mime_type: data.mimeType,
        size:      data.size,
        type:      getMimeFileType(data.mimeType),
        bucket,
        metadata:  (data.metadata ?? {}) as any,
      },
    });

    this.logger.log(`File saved: ${data.key}`);
    return file;
  }

  async getFile(id: string, userId: string) {
    const file = await this.prisma.file.findFirst({
      where: { id, user_id: userId },
    });

    if (!file) throw new NotFoundException('File not found');

    const downloadUrl = await this.r2.getDownloadUrl(file.key);
    return { ...file, downloadUrl };
  }

  async getUserFiles(userId: string, type?: FileTypeEnum) {
    return this.prisma.file.findMany({
      where: {
        user_id: userId,
        ...(type ? { type } : {}),
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async deleteFile(id: string, userId: string) {
    const file = await this.prisma.file.findFirst({
      where: { id, user_id: userId },
    });

    if (!file) throw new NotFoundException('File not found');

    await this.r2.deleteFile(file.key);
    await this.prisma.file.delete({ where: { id } });

    this.logger.log(`File deleted: ${file.key}`);
    return { success: true };
  }
}

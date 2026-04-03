import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException }   from '@nestjs/common';
import { StorageService, FileTypeEnum } from '../modules/storage/storage.service';
import { PrismaService }       from '../prisma/prisma.service';
import { R2Service }           from '../modules/storage/r2.service';

// ── Mock Data ─────────────────────────────────────────────────
const mockFile = {
  id:         'file-uuid-1',
  user_id:    'user-uuid-1',
  key:        'uploads/user-uuid-1/file-uuid-1.jpg',
  url:        'https://r2.example.com/tec-storage/uploads/user-uuid-1/file-uuid-1.jpg',
  filename:   'photo.jpg',
  mime_type:  'image/jpeg',
  size:       1024 * 100,
  type:       'IMAGE',
  bucket:     'tec-storage',
  metadata:   {},
  created_at: new Date(),
  updated_at: new Date(),
};

const prismaMock = {
  file: {
    create:    jest.fn(),
    findFirst: jest.fn(),
    findMany:  jest.fn(),
    delete:    jest.fn(),
  },
};

const r2Mock = {
  getUploadUrl:   jest.fn(),
  getDownloadUrl: jest.fn(),
  deleteFile:     jest.fn(),
};

// ── Tests ─────────────────────────────────────────────────────
describe('StorageService', () => {
  let service: StorageService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: R2Service,     useValue: r2Mock     },
      ],
    }).compile();

    service = module.get<StorageService>(StorageService);
    jest.clearAllMocks();
  });

  // ── getUploadUrl ──────────────────────────────────────────────
  describe('getUploadUrl', () => {
    it('returns upload URL for valid file', async () => {
      r2Mock.getUploadUrl.mockResolvedValue('https://presigned.url');

      const result = await service.getUploadUrl({
        userId:   'user-uuid-1',
        filename: 'photo.jpg',
        mimeType: 'image/jpeg',
        size:     1024 * 100,
      });

      expect(result.uploadUrl).toBe('https://presigned.url');
      expect(result.key).toContain('user-uuid-1');
      expect(result.fileId).toBeDefined();
    });

    it('throws when file exceeds 10MB', async () => {
      await expect(service.getUploadUrl({
        userId:   'user-uuid-1',
        filename: 'large.jpg',
        mimeType: 'image/jpeg',
        size:     11 * 1024 * 1024,
      })).rejects.toThrow('File size exceeds 10MB limit');
    });

    it('throws when MIME type not allowed', async () => {
      await expect(service.getUploadUrl({
        userId:   'user-uuid-1',
        filename: 'script.exe',
        mimeType: 'application/x-msdownload',
        size:     1024,
      })).rejects.toThrow('is not allowed');
    });

    it('uses custom folder when provided', async () => {
      r2Mock.getUploadUrl.mockResolvedValue('https://presigned.url');

      const result = await service.getUploadUrl({
        userId:   'user-uuid-1',
        filename: 'doc.pdf',
        mimeType: 'application/pdf',
        size:     1024,
        folder:   'documents',
      });

      expect(result.key).toContain('documents/');
    });
  });

  // ── saveFile ──────────────────────────────────────────────────
  describe('saveFile', () => {
    it('saves file metadata to DB', async () => {
      prismaMock.file.create.mockResolvedValue(mockFile);

      const result = await service.saveFile({
        userId:   'user-uuid-1',
        key:      'uploads/user-uuid-1/file-uuid-1.jpg',
        filename: 'photo.jpg',
        mimeType: 'image/jpeg',
        size:     1024 * 100,
      });

      expect(prismaMock.file.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            user_id:   'user-uuid-1',
            filename:  'photo.jpg',
            mime_type: 'image/jpeg',
            type:      'IMAGE',
          }),
        }),
      );
      expect(result).toEqual(mockFile);
    });

    it('correctly identifies VIDEO type', async () => {
      prismaMock.file.create.mockResolvedValue({ ...mockFile, type: 'VIDEO' });

      await service.saveFile({
        userId:   'user-uuid-1',
        key:      'uploads/user-uuid-1/video.mp4',
        filename: 'video.mp4',
        mimeType: 'video/mp4',
        size:     1024 * 1024,
      });

      expect(prismaMock.file.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'VIDEO' }),
        }),
      );
    });

    it('correctly identifies DOCUMENT type', async () => {
      prismaMock.file.create.mockResolvedValue({ ...mockFile, type: 'DOCUMENT' });

      await service.saveFile({
        userId:   'user-uuid-1',
        key:      'uploads/user-uuid-1/doc.pdf',
        filename: 'doc.pdf',
        mimeType: 'application/pdf',
        size:     512 * 1024,
      });

      expect(prismaMock.file.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'DOCUMENT' }),
        }),
      );
    });
  });

  // ── getFile ───────────────────────────────────────────────────
  describe('getFile', () => {
    it('returns file with download URL', async () => {
      prismaMock.file.findFirst.mockResolvedValue(mockFile);
      r2Mock.getDownloadUrl.mockResolvedValue('https://download.url');

      const result = await service.getFile('file-uuid-1', 'user-uuid-1');

      expect(result.downloadUrl).toBe('https://download.url');
      expect(result.id).toBe('file-uuid-1');
    });

    it('throws NotFoundException when file not found', async () => {
      prismaMock.file.findFirst.mockResolvedValue(null);

      await expect(service.getFile('non-existent', 'user-uuid-1'))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ── getUserFiles ──────────────────────────────────────────────
  describe('getUserFiles', () => {
    it('returns all files for user', async () => {
      prismaMock.file.findMany.mockResolvedValue([mockFile]);

      const result = await service.getUserFiles('user-uuid-1');

      expect(prismaMock.file.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_id: 'user-uuid-1' },
        }),
      );
      expect(result).toHaveLength(1);
    });

    it('filters by file type', async () => {
      prismaMock.file.findMany.mockResolvedValue([mockFile]);

      await service.getUserFiles('user-uuid-1', 'IMAGE');

      expect(prismaMock.file.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_id: 'user-uuid-1', type: 'IMAGE' },
        }),
      );
    });
  });

  // ── deleteFile ────────────────────────────────────────────────
  describe('deleteFile', () => {
    it('deletes file from R2 and DB', async () => {
      prismaMock.file.findFirst.mockResolvedValue(mockFile);
      r2Mock.deleteFile.mockResolvedValue(undefined);
      prismaMock.file.delete.mockResolvedValue(mockFile);

      const result = await service.deleteFile('file-uuid-1', 'user-uuid-1');

      expect(r2Mock.deleteFile).toHaveBeenCalledWith(mockFile.key);
      expect(prismaMock.file.delete).toHaveBeenCalledWith({
        where: { id: 'file-uuid-1' },
      });
      expect(result.success).toBe(true);
    });

    it('throws NotFoundException when file not found', async () => {
      prismaMock.file.findFirst.mockResolvedValue(null);

      await expect(service.deleteFile('non-existent', 'user-uuid-1'))
        .rejects.toThrow(NotFoundException);
    });
  });
});

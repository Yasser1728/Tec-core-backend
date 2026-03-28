import { Test, TestingModule } from '@nestjs/testing';
import { NotificationService, CreateNotificationDto } from '../src/modules/notification/notification.service';
import { PrismaService } from '../src/prisma/prisma.service';

const mockPrisma = {
  notification: {
    create:     jest.fn(),
    findMany:   jest.fn(),
    count:      jest.fn(),
    updateMany: jest.fn(),
  },
};

const baseNotification = {
  id:         'notif-123',
  user_id:    'user-456',
  type:       'PAYMENT',
  title:      '✅ Payment Successful',
  message:    'Your payment of 1 PI was completed.',
  read:       false,
  metadata:   {},
  created_at: new Date(),
  updated_at: new Date(),
};

let service: NotificationService;

beforeEach(async () => {
  jest.clearAllMocks();
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      NotificationService,
      { provide: PrismaService, useValue: mockPrisma },
    ],
  }).compile();
  service = module.get<NotificationService>(NotificationService);
});

// ══════════════════════════════════════════════════════════════
describe('NotificationService — create', () => {

  it('creates a PAYMENT notification', async () => {
    mockPrisma.notification.create.mockResolvedValue(baseNotification);
    const dto: CreateNotificationDto = {
      userId:   'user-456',
      type:     'PAYMENT',
      title:    '✅ Payment Successful',
      message:  'Your payment of 1 PI was completed.',
      metadata: { paymentId: 'pay-123', amount: 1 },
    };
    const result = await service.create(dto);
    expect(mockPrisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          user_id: 'user-456',
          type:    'PAYMENT',
          title:   '✅ Payment Successful',
        }),
      }),
    );
    expect(result).toEqual(baseNotification);
  });

  it('creates a SYSTEM notification', async () => {
    mockPrisma.notification.create.mockResolvedValue({ ...baseNotification, type: 'SYSTEM' });
    const result = await service.create({
      userId:  'user-456',
      type:    'SYSTEM',
      title:   '👋 Welcome!',
      message: 'Welcome to TEC!',
    });
    expect(result.type).toBe('SYSTEM');
  });

  it('creates notification with empty metadata when not provided', async () => {
    mockPrisma.notification.create.mockResolvedValue(baseNotification);
    await service.create({
      userId:  'user-456',
      type:    'WALLET',
      title:   'Wallet Update',
      message: 'Balance updated',
    });
    expect(mockPrisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ metadata: {} }),
      }),
    );
  });

  it('creates KYC notification', async () => {
    mockPrisma.notification.create.mockResolvedValue({ ...baseNotification, type: 'KYC' });
    const result = await service.create({
      userId:  'user-456',
      type:    'KYC',
      title:   'KYC Verified',
      message: 'Your identity has been verified.',
    });
    expect(result.type).toBe('KYC');
  });

  it('throws when prisma fails', async () => {
    mockPrisma.notification.create.mockRejectedValue(new Error('DB error'));
    await expect(
      service.create({ userId: 'u', type: 'SYSTEM', title: 't', message: 'm' }),
    ).rejects.toThrow('DB error');
  });
});

// ══════════════════════════════════════════════════════════════
describe('NotificationService — getByUserId', () => {

  it('returns notifications ordered by created_at desc', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([baseNotification]);
    const result = await service.getByUserId('user-456');
    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where:   { user_id: 'user-456' },
        orderBy: { created_at: 'desc' },
        take:    20,
      }),
    );
    expect(result).toHaveLength(1);
  });

  it('respects custom limit', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([]);
    await service.getByUserId('user-456', 5);
    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5 }),
    );
  });

  it('returns empty array when no notifications', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([]);
    const result = await service.getByUserId('user-000');
    expect(result).toEqual([]);
  });

  it('defaults to limit 20', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([]);
    await service.getByUserId('user-456');
    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20 }),
    );
  });
});

// ══════════════════════════════════════════════════════════════
describe('NotificationService — getUnreadCount', () => {

  it('returns unread count', async () => {
    mockPrisma.notification.count.mockResolvedValue(3);
    const count = await service.getUnreadCount('user-456');
    expect(count).toBe(3);
    expect(mockPrisma.notification.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user_id: 'user-456', read: false },
      }),
    );
  });

  it('returns 0 when all read', async () => {
    mockPrisma.notification.count.mockResolvedValue(0);
    const count = await service.getUnreadCount('user-456');
    expect(count).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════
describe('NotificationService — markAsRead', () => {

  it('marks single notification as read', async () => {
    mockPrisma.notification.updateMany.mockResolvedValue({ count: 1 });
    await service.markAsRead('notif-123', 'user-456');
    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'notif-123', user_id: 'user-456' },
        data:  { read: true },
      }),
    );
  });

  it('does not mark notification if userId does not match', async () => {
    mockPrisma.notification.updateMany.mockResolvedValue({ count: 0 });
    const result = await service.markAsRead('notif-123', 'wrong-user');
    expect(result).toEqual({ count: 0 });
  });
});

// ══════════════════════════════════════════════════════════════
describe('NotificationService — markAllAsRead', () => {

  it('marks all unread notifications as read', async () => {
    mockPrisma.notification.updateMany.mockResolvedValue({ count: 5 });
    await service.markAllAsRead('user-456');
    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user_id: 'user-456', read: false },
        data:  { read: true },
      }),
    );
  });

  it('returns count of updated notifications', async () => {
    mockPrisma.notification.updateMany.mockResolvedValue({ count: 3 });
    const result = await service.markAllAsRead('user-456');
    expect(result).toEqual({ count: 3 });
  });

  it('handles case when no unread notifications', async () => {
    mockPrisma.notification.updateMany.mockResolvedValue({ count: 0 });
    const result = await service.markAllAsRead('user-456');
    expect(result).toEqual({ count: 0 });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { Logger }              from '@nestjs/common';
import { NotificationService, CreateNotificationDto } from '../modules/notification/notification.service';
import { PrismaService }       from '../prisma/prisma.service';
import { FcmService }          from '../modules/notification/fcm.service';

// ── Mocks ─────────────────────────────────────────────────────
const mockNotification = {
  id:         'notif-uuid-1',
  user_id:    'user-uuid-1',
  type:       'PAYMENT',
  title:      'Payment Received',
  message:    'You received 10 PI',
  metadata:   {},
  read:       false,
  created_at: new Date(),
};

const prismaMock = {
  notification: {
    create:     jest.fn(),
    findMany:   jest.fn(),
    count:      jest.fn(),
    updateMany: jest.fn(),
  },
  deviceToken: {
    findMany: jest.fn(),
  },
};

const fcmMock = {
  isEnabled:    false,
  sendToTokens: jest.fn(),
};

// ── Tests ─────────────────────────────────────────────────────
describe('NotificationService', () => {
  let service: NotificationService;

  const dto: CreateNotificationDto = {
    userId:  'user-uuid-1',
    type:    'PAYMENT',
    title:   'Payment Received',
    message: 'You received 10 PI',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: FcmService,    useValue: fcmMock    },
      ],
    })
      .setLogger(new Logger())
      .compile();

    service = module.get<NotificationService>(NotificationService);
    jest.clearAllMocks();
  });

  // ── create ───────────────────────────────────────────────────
  describe('create', () => {
    it('saves notification to DB', async () => {
      prismaMock.notification.create.mockResolvedValue(mockNotification);

      const result = await service.create(dto);

      expect(prismaMock.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          user_id: 'user-uuid-1',
          type:    'PAYMENT',
          title:   'Payment Received',
          message: 'You received 10 PI',
        }),
      });
      expect(result).toEqual(mockNotification);
    });

    it('does NOT send FCM when disabled', async () => {
      prismaMock.notification.create.mockResolvedValue(mockNotification);
      fcmMock.isEnabled = false;

      await service.create(dto);

      expect(fcmMock.sendToTokens).not.toHaveBeenCalled();
    });

    it('sends FCM push when enabled', async () => {
      prismaMock.notification.create.mockResolvedValue(mockNotification);
      prismaMock.deviceToken.findMany.mockResolvedValue([
        { token: 'fcm-token-1' },
      ]);
      fcmMock.sendToTokens.mockResolvedValue({ failed: 0 });
      fcmMock.isEnabled = true;

      await service.create(dto);

      // FCM is non-blocking — wait for microtasks
      await new Promise(r => setTimeout(r, 10));

      expect(fcmMock.sendToTokens).toHaveBeenCalledWith(
        ['fcm-token-1'],
        'Payment Received',
        'You received 10 PI',
        expect.objectContaining({ type: 'PAYMENT' }),
      );

      fcmMock.isEnabled = false;
    });

    it('skips FCM push when no device tokens', async () => {
      prismaMock.notification.create.mockResolvedValue(mockNotification);
      prismaMock.deviceToken.findMany.mockResolvedValue([]);
      fcmMock.isEnabled = true;

      await service.create(dto);
      await new Promise(r => setTimeout(r, 10));

      expect(fcmMock.sendToTokens).not.toHaveBeenCalled();
      fcmMock.isEnabled = false;
    });
  });

  // ── getByUserId ───────────────────────────────────────────────
  describe('getByUserId', () => {
    it('returns notifications for user', async () => {
      prismaMock.notification.findMany.mockResolvedValue([mockNotification]);

      const result = await service.getByUserId('user-uuid-1');

      expect(prismaMock.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_id: 'user-uuid-1' },
          take:  20,
        }),
      );
      expect(result).toHaveLength(1);
    });

    it('respects custom limit', async () => {
      prismaMock.notification.findMany.mockResolvedValue([]);

      await service.getByUserId('user-uuid-1', 5);

      expect(prismaMock.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });
  });

  // ── getUnreadCount ────────────────────────────────────────────
  describe('getUnreadCount', () => {
    it('returns unread count', async () => {
      prismaMock.notification.count.mockResolvedValue(3);

      const result = await service.getUnreadCount('user-uuid-1');

      expect(result).toBe(3);
      expect(prismaMock.notification.count).toHaveBeenCalledWith({
        where: { user_id: 'user-uuid-1', read: false },
      });
    });
  });

  // ── markAsRead ────────────────────────────────────────────────
  describe('markAsRead', () => {
    it('marks single notification as read', async () => {
      prismaMock.notification.updateMany.mockResolvedValue({ count: 1 });

      await service.markAsRead('notif-uuid-1', 'user-uuid-1');

      expect(prismaMock.notification.updateMany).toHaveBeenCalledWith({
        where: { id: 'notif-uuid-1', user_id: 'user-uuid-1' },
        data:  { read: true },
      });
    });
  });

  // ── markAllAsRead ─────────────────────────────────────────────
  describe('markAllAsRead', () => {
    it('marks all notifications as read', async () => {
      prismaMock.notification.updateMany.mockResolvedValue({ count: 5 });

      await service.markAllAsRead('user-uuid-1');

      expect(prismaMock.notification.updateMany).toHaveBeenCalledWith({
        where: { user_id: 'user-uuid-1', read: false },
        data:  { read: true },
      });
    });
  });
});

import { Test, TestingModule }   from '@nestjs/testing';
import { INestApplication }      from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { NotificationController } from '../modules/notification/notification.controller';
import { NotificationService }    from '../modules/notification/notification.service';

// ── Mock Data ─────────────────────────────────────────────
const mockNotification = {
  id:         'notif-uuid-1',
  user_id:    'user-uuid-1',
  type:       'PAYMENT',
  title:      'Payment Received',
  message:    'You received 10 PI',
  read:       false,
  created_at: new Date().toISOString(),
};

const notificationServiceMock = {
  getByUserId:    jest.fn().mockResolvedValue([mockNotification]),
  getUnreadCount: jest.fn().mockResolvedValue(1),
  markAsRead:     jest.fn().mockResolvedValue({ count: 1 }),
  markAllAsRead:  jest.fn().mockResolvedValue({ count: 3 }),
};

// ── Tests ─────────────────────────────────────────────────
describe('NotificationController (Integration)', () => {
  let app:        INestApplication;
  let jwtService: JwtService;
  let validToken: string;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret:      'test-secret',
          signOptions: { expiresIn: '1d' },
        }),
      ],
      controllers: [NotificationController],
      providers: [
        { provide: NotificationService, useValue: notificationServiceMock },
      ],
    }).compile();

    app        = module.createNestApplication();
    jwtService = module.get<JwtService>(JwtService);
    await app.init();

    // ✅ توليد token صالح للـ tests
    validToken = jwtService.sign({ sub: 'user-uuid-1' });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    notificationServiceMock.getByUserId.mockResolvedValue([mockNotification]);
    notificationServiceMock.getUnreadCount.mockResolvedValue(1);
    notificationServiceMock.markAsRead.mockResolvedValue({ count: 1 });
    notificationServiceMock.markAllAsRead.mockResolvedValue({ count: 3 });
  });

  // ── GET /notifications ─────────────────────────────────
  describe('GET /notifications', () => {
    it('returns notifications for authenticated user', async () => {
      const res = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', `Bearer ${validToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.notifications).toHaveLength(1);
      expect(res.body.data.unreadCount).toBe(1);
      expect(notificationServiceMock.getByUserId).toHaveBeenCalledWith('user-uuid-1', 20);
    });

    it('respects custom limit', async () => {
      const res = await request(app.getHttpServer())
        .get('/notifications?limit=5')
        .set('Authorization', `Bearer ${validToken}`);

      expect(res.status).toBe(200);
      expect(notificationServiceMock.getByUserId).toHaveBeenCalledWith('user-uuid-1', 5);
    });

    it('returns 401 when token is missing', async () => {
      const res = await request(app.getHttpServer())
        .get('/notifications');

      expect(res.status).toBe(401);
    });

    it('returns 401 when token is invalid', async () => {
      const res = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
    });

    it('returns 401 when token format is wrong', async () => {
      const res = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', 'InvalidFormat');

      expect(res.status).toBe(401);
    });
  });

  // ── PATCH /notifications/:id/read ─────────────────────
  describe('PATCH /notifications/:id/read', () => {
    it('marks notification as read', async () => {
      const res = await request(app.getHttpServer())
        .patch('/notifications/notif-uuid-1/read')
        .set('Authorization', `Bearer ${validToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(notificationServiceMock.markAsRead).toHaveBeenCalledWith(
        'notif-uuid-1',
        'user-uuid-1',
      );
    });

    it('returns 401 when token is missing', async () => {
      const res = await request(app.getHttpServer())
        .patch('/notifications/notif-uuid-1/read');

      expect(res.status).toBe(401);
    });
  });

  // ── PATCH /notifications/read-all ─────────────────────
  describe('PATCH /notifications/read-all', () => {
    it('marks all notifications as read', async () => {
      const res = await request(app.getHttpServer())
        .patch('/notifications/read-all')
        .set('Authorization', `Bearer ${validToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(notificationServiceMock.markAllAsRead).toHaveBeenCalledWith('user-uuid-1');
    });

    it('returns 401 when token is missing', async () => {
      const res = await request(app.getHttpServer())
        .patch('/notifications/read-all');

      expect(res.status).toBe(401);
    });
  });
});

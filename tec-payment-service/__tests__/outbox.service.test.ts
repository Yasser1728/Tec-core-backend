import { saveOutboxEvent, markEventPublished, markEventFailed } from '../src/services/outbox.service';

// ── Mock Prisma ──────────────────────────────────────────
const mockCreate = jest.fn();
const mockUpdate = jest.fn();

jest.mock('../src/config/database', () => ({
  prisma: {
    outboxEvent: {
      create: (...args: any[]) => mockCreate(...args),
      update: (...args: any[]) => mockUpdate(...args),
    },
  },
}));

jest.mock('../src/utils/logger', () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

beforeEach(() => jest.clearAllMocks());

describe('OutboxService', () => {

  describe('saveOutboxEvent', () => {
    it('saves event via transaction client', async () => {
      const mockTx = { outboxEvent: { create: jest.fn() } } as any;
      await saveOutboxEvent(mockTx, {
        streamName: 'payment.completed',
        payload: { paymentId: 'pay-123', userId: 'user-456', amount: 1 },
      });
      expect(mockTx.outboxEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            stream_name: 'payment.completed',
            status: 'pending',
          }),
        }),
      );
    });

    it('throws if transaction client fails', async () => {
      const mockTx = {
        outboxEvent: { create: jest.fn().mockRejectedValue(new Error('DB error')) },
      } as any;
      await expect(
        saveOutboxEvent(mockTx, { streamName: 'test', payload: {} }),
      ).rejects.toThrow('DB error');
    });
  });

  describe('markEventPublished', () => {
    it('updates status to published', async () => {
      mockUpdate.mockResolvedValue({});
      await markEventPublished('event-123');
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'event-123' },
          data: expect.objectContaining({ status: 'published' }),
        }),
      );
    });
  });

  describe('markEventFailed', () => {
    it('marks as failed when max attempts reached', async () => {
      mockUpdate.mockResolvedValue({});
      await markEventFailed('event-123', 'Redis error', 5, 5);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'failed' }),
        }),
      );
    });

    it('keeps status pending when attempts below max', async () => {
      mockUpdate.mockResolvedValue({});
      await markEventFailed('event-123', 'Redis error', 2, 5);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'pending' }),
        }),
      );
    });

    it('increments attempts count', async () => {
      mockUpdate.mockResolvedValue({});
      await markEventFailed('event-123', 'error', 3, 5);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ attempts: 4 }),
        }),
      );
    });
  });
});

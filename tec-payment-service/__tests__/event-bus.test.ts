import { publishEvent, ensureConsumerGroup } from '../src/services/event-bus';

const mockXadd   = jest.fn();
const mockXgroup = jest.fn();

const mockRedis = {
  xadd:   mockXadd,
  xgroup: mockXgroup,
} as any;

beforeEach(() => jest.clearAllMocks());

describe('EventBus', () => {

  describe('publishEvent', () => {
    it('publishes event to Redis stream', async () => {
      mockXadd.mockResolvedValue('1234-0');
      const payload = { paymentId: 'pay-1', amount: 1 };
      const id = await publishEvent(mockRedis, 'payment.completed', payload);
      expect(mockXadd).toHaveBeenCalledWith(
        'payment.completed',
        '*',
        'data',      JSON.stringify(payload),
        'timestamp', expect.any(String),
      );
      expect(id).toBe('1234-0');
    });

    it('throws when xadd returns null', async () => {
      mockXadd.mockResolvedValue(null);
      await expect(
        publishEvent(mockRedis, 'payment.completed', {}),
      ).rejects.toThrow('Failed to publish to stream');
    });

    it('throws when xadd rejects', async () => {
      mockXadd.mockRejectedValue(new Error('Redis error'));
      await expect(
        publishEvent(mockRedis, 'payment.completed', {}),
      ).rejects.toThrow('Redis error');
    });
  });

  describe('ensureConsumerGroup', () => {
    it('creates consumer group successfully', async () => {
      mockXgroup.mockResolvedValue('OK');
      await expect(
        ensureConsumerGroup(mockRedis, 'payment.completed', 'wallet-group'),
      ).resolves.not.toThrow();
    });

    it('ignores BUSYGROUP error (group already exists)', async () => {
      mockXgroup.mockRejectedValue(new Error('BUSYGROUP Consumer Group already exists'));
      await expect(
        ensureConsumerGroup(mockRedis, 'payment.completed', 'wallet-group'),
      ).resolves.not.toThrow();
    });

    it('throws on unexpected errors', async () => {
      mockXgroup.mockRejectedValue(new Error('Connection refused'));
      await expect(
        ensureConsumerGroup(mockRedis, 'payment.completed', 'wallet-group'),
      ).rejects.toThrow('Connection refused');
    });
  });
});

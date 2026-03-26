import { publishEvent, ensureConsumerGroup } from '../src/event-bus';

const mockXadd   = jest.fn();
const mockXgroup = jest.fn();

const mockRedis = { xadd: mockXadd, xgroup: mockXgroup } as any;

beforeEach(() => jest.clearAllMocks());

describe('EventBus — publishEvent', () => {

  it('publishes event and returns message ID', async () => {
    mockXadd.mockResolvedValue('1234-0');
    const id = await publishEvent(mockRedis, 'payment.completed', { amount: 1 });
    expect(id).toBe('1234-0');
    expect(mockXadd).toHaveBeenCalledWith(
      'payment.completed', '*',
      'data', JSON.stringify({ amount: 1 }),
      'timestamp', expect.any(String),
    );
  });

  it('throws when xadd returns null', async () => {
    mockXadd.mockResolvedValue(null);
    await expect(publishEvent(mockRedis, 'test', {})).rejects.toThrow('Failed to publish');
  });

  it('throws when xadd rejects', async () => {
    mockXadd.mockRejectedValue(new Error('Redis down'));
    await expect(publishEvent(mockRedis, 'test', {})).rejects.toThrow('Redis down');
  });
});

describe('EventBus — ensureConsumerGroup', () => {

  it('creates consumer group successfully', async () => {
    mockXgroup.mockResolvedValue('OK');
    await expect(ensureConsumerGroup(mockRedis, 'payment.completed', 'wallet-group')).resolves.not.toThrow();
  });

  it('ignores BUSYGROUP error', async () => {
    mockXgroup.mockRejectedValue(new Error('BUSYGROUP Consumer Group already exists'));
    await expect(ensureConsumerGroup(mockRedis, 'payment.completed', 'wallet-group')).resolves.not.toThrow();
  });

  it('throws on unexpected errors', async () => {
    mockXgroup.mockRejectedValue(new Error('Connection refused'));
    await expect(ensureConsumerGroup(mockRedis, 'payment.completed', 'wallet-group')).rejects.toThrow('Connection refused');
  });
});

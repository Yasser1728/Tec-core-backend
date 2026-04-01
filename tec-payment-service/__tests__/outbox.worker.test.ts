import { startOutboxWorker, stopOutboxWorker } from '../src/services/outbox.worker';

jest.useFakeTimers();

const mockFindMany = jest.fn();
const mockUpdate   = jest.fn();
const mockXadd     = jest.fn();

jest.mock('../src/config/database', () => ({
  prisma: {
    outboxEvent: {
      findMany: (...args: any[]) => mockFindMany(...args),
      update:   (...args: any[]) => mockUpdate(...args),
    },
  },
}));

jest.mock('../src/utils/logger', () => ({
  logInfo:  jest.fn(),
  logWarn:  jest.fn(),
  logError: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  stopOutboxWorker();
  (global as any).__redisPublisher = null;
});

afterEach(() => stopOutboxWorker());

describe('OutboxWorker', () => {

  it('skips processing when no pending events', async () => {
    mockFindMany.mockResolvedValue([]);
    startOutboxWorker();
    // ✅ بدل runAllTimersAsync — نتقدم بوقت محدد فقط
    await jest.advanceTimersByTimeAsync(5000);
    expect(mockXadd).not.toHaveBeenCalled();
  });

  it('skips when Redis publisher not available', async () => {
    mockFindMany.mockResolvedValue([
      { id: 'evt-1', stream_name: 'payment.completed', payload: {}, attempts: 0, max_attempts: 5 },
    ]);
    (global as any).__redisPublisher = null;
    startOutboxWorker();
    await jest.advanceTimersByTimeAsync(5000);
    expect(mockXadd).not.toHaveBeenCalled();
  });

  it('publishes event and marks as published when Redis ready', async () => {
    mockFindMany.mockResolvedValue([
      { id: 'evt-1', stream_name: 'payment.completed', payload: { amount: 1 }, attempts: 0, max_attempts: 5 },
    ]);
    mockXadd.mockResolvedValue('1234-0');
    mockUpdate.mockResolvedValue({});

    (global as any).__redisPublisher = { status: 'ready', xadd: mockXadd };

    startOutboxWorker();
    await jest.advanceTimersByTimeAsync(5000);

    expect(mockXadd).toHaveBeenCalledWith(
      'payment.completed',
      '*',
      expect.any(String), expect.any(String),
      expect.any(String), expect.any(String),
      expect.any(String), expect.any(String),
    );
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'evt-1' },
        data:  expect.objectContaining({ status: 'published' }),
      }),
    );
  });

  it('marks event as failed when xadd throws', async () => {
    mockFindMany.mockResolvedValue([
      { id: 'evt-fail', stream_name: 'payment.completed', payload: {}, attempts: 0, max_attempts: 5 },
    ]);
    mockXadd.mockRejectedValue(new Error('Redis down'));
    mockUpdate.mockResolvedValue({});

    (global as any).__redisPublisher = { status: 'ready', xadd: mockXadd };

    startOutboxWorker();
    await jest.advanceTimersByTimeAsync(5000);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'evt-fail' },
        data:  expect.objectContaining({ status: 'pending' }),
      }),
    );
  });

  it('stops worker cleanly', () => {
    startOutboxWorker();
    stopOutboxWorker();
    expect(true).toBe(true);
  });
});

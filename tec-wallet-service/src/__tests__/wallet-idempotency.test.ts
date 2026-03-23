import { PrismaClient } from '../../prisma/client';
import { WalletService } from '../wallet/wallet.service';
import { PaymentCompletedEvent } from '../event-bus';

// ─── Test DB ──────────────────────────────────────────────────
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL } },
});

const walletService = new WalletService(prisma);

// ─── Helpers ──────────────────────────────────────────────────
const makeEvent = (overrides: Partial<PaymentCompletedEvent> = {}): PaymentCompletedEvent => ({
  paymentId:   `pay_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  userId:      'test-user-idempotency',
  amount:      50,
  currency:    'PI',
  piPaymentId: `pi_${Date.now()}`,
  timestamp:   new Date().toISOString(),
  ...overrides,
});

const cleanupUser = async (userId: string) => {
  const wallets = await prisma.wallet.findMany({ where: { user_id: userId } });
  for (const w of wallets) {
    await prisma.transaction.deleteMany({ where: { wallet_id: w.id } });
    await prisma.auditLog.deleteMany({ where: { entity_id: w.id } });
  }
  await prisma.wallet.deleteMany({ where: { user_id: userId } });
  await prisma.processedEvent.deleteMany({ where: { user_id: userId } });
};

// ─────────────────────────────────────────────────────────────
describe('WalletService — Idempotency Tests', () => {

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await cleanupUser('test-user-idempotency');
    await cleanupUser('test-user-race');
    await cleanupUser('test-user-multi');
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanupUser('test-user-idempotency');
  });

  // ═══════════════════════════════════════════════════════════
  // TEST 1 — الحالة الطبيعية
  // ═══════════════════════════════════════════════════════════
  it('should credit wallet once for valid payment', async () => {
    const event = makeEvent({ amount: 100 });

    await walletService.handlePaymentCompleted(event);

    const balance = await walletService.getBalance('test-user-idempotency');
    expect(balance).toBe(100);
  });

  // ═══════════════════════════════════════════════════════════
  // TEST 2 — CRITICAL: Duplicate event
  // ═══════════════════════════════════════════════════════════
  it('CRITICAL: should NOT double-credit on duplicate event', async () => {
    const event = makeEvent({ amount: 75 });

    await walletService.handlePaymentCompleted(event);
    await walletService.handlePaymentCompleted(event); // duplicate!

    const balance = await walletService.getBalance('test-user-idempotency');

    // 75 وليس 150
    expect(balance).toBe(75);
  });

  // ═══════════════════════════════════════════════════════════
  // TEST 3 — CRITICAL: 10x duplicate storm
  // ═══════════════════════════════════════════════════════════
  it('CRITICAL: should handle 10x duplicate events — balance unchanged', async () => {
    const event = makeEvent({ amount: 25 });

    // نفس الـ event 10 مرات متتالية
    for (let i = 0; i < 10; i++) {
      await walletService.handlePaymentCompleted(event);
    }

    const balance = await walletService.getBalance('test-user-idempotency');
    expect(balance).toBe(25);
  });

  // ═══════════════════════════════════════════════════════════
  // TEST 4 — Ledger entry واحد بالضبط
  // ═══════════════════════════════════════════════════════════
  it('should create exactly ONE ledger entry per unique paymentId', async () => {
    const event = makeEvent({ amount: 30 });

    await walletService.handlePaymentCompleted(event);
    await walletService.handlePaymentCompleted(event); // duplicate
    await walletService.handlePaymentCompleted(event); // duplicate

    const wallet = await prisma.wallet.findFirst({
      where: { user_id: 'test-user-idempotency' },
    });
    expect(wallet).not.toBeNull();

    const entries = await prisma.transaction.findMany({
      where: {
        wallet_id:   wallet!.id,
        description: `payment:${event.paymentId}`,
      },
    });

    expect(entries).toHaveLength(1);
    expect(Number(entries[0].amount)).toBe(30);
    expect(entries[0].type).toBe('CREDIT');
  });

  // ═══════════════════════════════════════════════════════════
  // TEST 5 — ProcessedEvent يُحفظ صح
  // ═══════════════════════════════════════════════════════════
  it('should store ProcessedEvent with correct key', async () => {
    const event = makeEvent();

    await walletService.handlePaymentCompleted(event);

    const processed = await prisma.processedEvent.findUnique({
      where: { event_key: `payment:${event.paymentId}` },
    });

    expect(processed).not.toBeNull();
    expect(processed!.user_id).toBe('test-user-idempotency');
    expect(processed!.processed_at).toBeInstanceOf(Date);
  });

  // ═══════════════════════════════════════════════════════════
  // TEST 6 — Payments مختلفة كلها تتعالج
  // ═══════════════════════════════════════════════════════════
  it('should process multiple DIFFERENT payments correctly', async () => {
    const events = [
      makeEvent({ amount: 10 }),
      makeEvent({ amount: 20 }),
      makeEvent({ amount: 30 }),
    ];

    for (const e of events) {
      await walletService.handlePaymentCompleted(e);
    }

    const balance = await walletService.getBalance('test-user-idempotency');
    expect(balance).toBe(60); // 10 + 20 + 30

    const { total } = await walletService.getTransactions('test-user-idempotency');
    expect(total).toBe(3);
  });

  // ═══════════════════════════════════════════════════════════
  // TEST 7 — CRITICAL: Race Condition
  // ═══════════════════════════════════════════════════════════
  it('CRITICAL: race condition — concurrent duplicate events must not double-credit', async () => {
    await cleanupUser('test-user-race');

    const event: PaymentCompletedEvent = {
      ...makeEvent({ amount: 60 }),
      userId: 'test-user-race',
    };

    // 3 consumers يعالجوا نفس الـ event في نفس اللحظة
    const results = await Promise.allSettled([
      walletService.handlePaymentCompleted(event),
      walletService.handlePaymentCompleted(event),
      walletService.handlePaymentCompleted(event),
    ]);

    // بعض النتائج ممكن تكون rejected بسبب unique constraint — ده صح
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    const balance = await walletService.getBalance('test-user-race');

    // الرصيد 60 بالضبط مهما كان عدد المحاولات
    expect(balance).toBe(60);

    // Ledger entry واحد بالضبط
    const wallet = await prisma.wallet.findFirst({ where: { user_id: 'test-user-race' } });
    const entries = await prisma.transaction.findMany({
      where: { wallet_id: wallet!.id, description: `payment:${event.paymentId}` },
    });
    expect(entries).toHaveLength(1);
  });

  // ═══════════════════════════════════════════════════════════
  // TEST 8 — AuditLog يُسجَّل صح
  // ═══════════════════════════════════════════════════════════
  it('should create audit log with correct before/after balance', async () => {
    const event = makeEvent({ amount: 45 });

    await walletService.handlePaymentCompleted(event);

    const wallet = await prisma.wallet.findFirst({
      where: { user_id: 'test-user-idempotency' },
    });

    const audit = await prisma.auditLog.findFirst({
      where: { entity_id: wallet!.id, action: 'credit' },
    });

    expect(audit).not.toBeNull();
    expect((audit!.before as any).balance).toBe(0);
    expect((audit!.after  as any).balance).toBe(45);
  });

  // ═══════════════════════════════════════════════════════════
  // TEST 9 — Reject zero/negative amount
  // ═══════════════════════════════════════════════════════════
  it('should reject zero or negative amount', async () => {
    await expect(
      walletService.handlePaymentCompleted(makeEvent({ amount: 0 })),
    ).rejects.toThrow('Invalid amount');

    await expect(
      walletService.handlePaymentCompleted(makeEvent({ amount: -50 })),
    ).rejects.toThrow('Invalid amount');

    const balance = await walletService.getBalance('test-user-idempotency');
    expect(balance).toBe(0);
  });

  // ═══════════════════════════════════════════════════════════
  // TEST 10 — Wallet يُنشأ تلقائياً لو مش موجود
  // ═══════════════════════════════════════════════════════════
  it('should auto-create wallet for new user', async () => {
    await cleanupUser('test-user-multi');

    const event: PaymentCompletedEvent = {
      ...makeEvent({ amount: 100 }),
      userId: 'test-user-multi',
    };

    // المستخدم ما عنده wallet بعد
    const before = await prisma.wallet.findFirst({ where: { user_id: 'test-user-multi' } });
    expect(before).toBeNull();

    await walletService.handlePaymentCompleted(event);

    const wallet = await prisma.wallet.findFirst({ where: { user_id: 'test-user-multi' } });
    expect(wallet).not.toBeNull();
    expect(Number(wallet!.balance)).toBe(100);
    expect(wallet!.is_primary).toBe(true);
  });
});

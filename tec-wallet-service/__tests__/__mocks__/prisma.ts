export const PrismaClient = jest.fn().mockImplementation(() => ({
  wallet:         { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  transaction:    { create: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  processedEvent: { findUnique: jest.fn(), create: jest.fn() },
  auditLog:       { create: jest.fn() },
  $transaction:   jest.fn(),
  $connect:       jest.fn(),
  $disconnect:    jest.fn(),
}));

export const Prisma = {
  TransactionClient: {},
  Decimal: Number,
};

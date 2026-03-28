export const PrismaClient = jest.fn().mockImplementation(() => ({
  user:         { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  refreshToken: { create: jest.fn(), findUnique: jest.fn(), delete: jest.fn(), deleteMany: jest.fn() },
  session:      { create: jest.fn(), delete: jest.fn(), deleteMany: jest.fn() },
  auditLog:     { create: jest.fn() },
  loginAttempt: { create: jest.fn(), count: jest.fn() },
  $connect:     jest.fn(),
  $disconnect:  jest.fn(),
  $transaction: jest.fn(),
}));

export const Prisma = { PrismaClientKnownRequestError: class {} };

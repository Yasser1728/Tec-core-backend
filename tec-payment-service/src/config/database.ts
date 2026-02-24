import { PrismaClient } from '../../prisma/client';

/** Typed global for singleton reuse across hot-reloads in non-production envs. */
type GlobalWithPrisma = typeof globalThis & { _prismaPayment?: PrismaClient };

const globalForPrisma = global as GlobalWithPrisma;

// Prisma Client singleton pattern
const prisma: PrismaClient =
  globalForPrisma._prismaPayment ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  // Re-use the same client across hot-reloads to avoid exhausting connections.
  globalForPrisma._prismaPayment = prisma;
}

export { prisma };
import { PrismaClient } from '../../prisma/client';

// Typed global to hold the singleton Prisma Client in development
declare global {
  var __prismaAuth: PrismaClient | undefined;
}

// Prisma Client singleton pattern
let prisma: PrismaClient;

if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient();
} else {
  // In development, use a global variable to prevent multiple instances
  if (!global.__prismaAuth) {
    global.__prismaAuth = new PrismaClient();
  }
  prisma = global.__prismaAuth;
}

export { prisma };
export const PrismaClient = jest.fn().mockImplementation(() => mockPrismaInstance);

export const mockPrismaInstance = {
  product: {
    create:     jest.fn(),
    findMany:   jest.fn(),
    findUnique: jest.fn(),
    findFirst:  jest.fn(),
    update:     jest.fn(),
    count:      jest.fn(),
  },
  order: {
    create:     jest.fn(),
    findMany:   jest.fn(),
    findUnique: jest.fn(),
    findFirst:  jest.fn(),
    update:     jest.fn(),
    count:      jest.fn(),
  },
  orderItem:     { create: jest.fn(), findMany: jest.fn() },
  orderTimeline: { create: jest.fn() },
  $transaction:  jest.fn(),
  $connect:      jest.fn(),
  $disconnect:   jest.fn(),
};

export const Prisma = {
  TransactionClient: {},
};

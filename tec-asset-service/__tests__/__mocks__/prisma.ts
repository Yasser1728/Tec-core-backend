export const PrismaClient = jest.fn().mockImplementation(() => ({
  asset: {
    findUnique: jest.fn(),
    findMany:   jest.fn(),
    create:     jest.fn(),
  },
  assetHistory: { create: jest.fn() },
  $transaction: jest.fn(),
  $connect:     jest.fn(),
  $disconnect:  jest.fn(),
}));

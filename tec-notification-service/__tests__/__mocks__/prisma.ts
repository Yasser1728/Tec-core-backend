export const PrismaClient = jest.fn().mockImplementation(() => ({
  notification: {
    create:     jest.fn(),
    findMany:   jest.fn(),
    count:      jest.fn(),
    updateMany: jest.fn(),
  },
  $connect:    jest.fn(),
  $disconnect: jest.fn(),
}));

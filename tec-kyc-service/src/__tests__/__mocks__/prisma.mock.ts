export const PrismaService = jest.fn().mockImplementation(() => ({
  kyc: {
    findUnique: jest.fn(),
    create:     jest.fn(),
    update:     jest.fn(),
  },
  kycAuditLog: {
    create: jest.fn(),
  },
}));

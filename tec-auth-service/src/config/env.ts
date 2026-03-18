export const env = {
  JWT_SECRET: process.env.JWT_SECRET || 'tec-secret',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '24h',
  DATABASE_URL: process.env.DATABASE_URL || '',
  PORT: process.env.PORT || '3001',
};

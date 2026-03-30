export const env = {
  JWT_SECRET:  process.env.JWT_SECRET  || (() => { throw new Error('JWT_SECRET is required'); })(),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '24h',
  DATABASE_URL: process.env.DATABASE_URL || '',
  PORT: process.env.PORT || '5001',
};

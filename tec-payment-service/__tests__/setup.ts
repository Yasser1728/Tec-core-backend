process.env.PORT            = '3001';
process.env.DATABASE_URL    = 'postgresql://test:test@localhost:5432/testdb';
process.env.JWT_SECRET      = 'test-jwt-secret-for-jest-at-least-32-chars!!';
process.env.NODE_ENV        = 'test';
process.env.PI_API_KEY      = 'test-pi-api-key';
process.env.PI_APP_ID       = 'test-pi-app-id';
process.env.REDIS_URL       = 'redis://localhost:6379';   // ← ناقص
process.env.INTERNAL_SECRET = 'test-internal-secret';

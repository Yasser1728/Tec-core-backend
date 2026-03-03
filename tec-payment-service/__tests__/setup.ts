// Jest global setup – runs before any test module is imported.
// Sets minimum required env vars so Zod schema validation in env.ts passes.
process.env.PORT = '3001';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/testdb';
process.env.JWT_SECRET = 'test-jwt-secret-for-jest-at-least-32-chars!!';
process.env.NODE_ENV = 'test';
process.env.PI_API_KEY = 'test-pi-api-key';
process.env.PI_APP_ID = 'test-pi-app-id';

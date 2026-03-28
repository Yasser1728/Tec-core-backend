process.env.NODE_ENV        = 'test';
process.env.DATABASE_URL    = 'postgresql://test:test@localhost:5432/testdb';
process.env.JWT_SECRET      = 'test-jwt-secret-for-unit-tests-at-least-32-chars!!';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-for-unit-tests!!';
process.env.INTERNAL_SECRET = 'test-internal-secret';
process.env.PORT            = '5001';

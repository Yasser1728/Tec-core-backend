process.env.PORT           = '5003';
process.env.NODE_ENV       = 'test';
process.env.DATABASE_URL   = 'postgresql://test:test@localhost:5432/tec_payment_test';
process.env.REDIS_URL      = 'redis://localhost:6379';
process.env.JWT_SECRET     = 'test-jwt-secret-min-32-chars-long!!';
process.env.INTERNAL_SECRET = 'test-internal-secret-32-chars!!';
process.env.PI_API_KEY     = 'test-pi-api-key';
process.env.PI_SANDBOX     = 'true';

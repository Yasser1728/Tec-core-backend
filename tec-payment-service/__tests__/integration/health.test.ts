import request from 'supertest';
import express from 'express';

// Mock app setup for testing health endpoint
const app = express();
const serviceStartTime = Date.now();
const SERVICE_VERSION = '1.0.0';

app.get('/health', (_req, res) => {
  const uptime = Math.floor((Date.now() - serviceStartTime) / 1000);
  res.json({
    status: 'ok',
    service: 'payment-service',
    timestamp: new Date().toISOString(),
    uptime,
    version: SERVICE_VERSION,
  });
});

describe('Payment Service Health Check', () => {
  it('should return 200 status', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
  });

  it('should return health status object', async () => {
    const response = await request(app).get('/health');
    
    expect(response.body).toHaveProperty('status');
    expect(response.body).toHaveProperty('service');
    expect(response.body).toHaveProperty('timestamp');
    expect(response.body).toHaveProperty('uptime');
    expect(response.body).toHaveProperty('version');
  });

  it('should have correct service name', async () => {
    const response = await request(app).get('/health');
    expect(response.body.service).toBe('payment-service');
  });
});
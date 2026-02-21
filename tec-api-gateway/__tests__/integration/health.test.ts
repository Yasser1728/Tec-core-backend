import request from 'supertest';
import express from 'express';

// Mock app setup for testing
const app = express();
const serviceStartTime = Date.now();
const SERVICE_VERSION = '1.0.0';

// Health check endpoint
app.get('/health', async (req, res) => {
  const uptime = Math.floor((Date.now() - serviceStartTime) / 1000);
  
  const healthResponse: any = {
    status: 'ok',
    service: 'api-gateway',
    timestamp: new Date().toISOString(),
    uptime,
    version: SERVICE_VERSION,
    services: {},
  };

  res.json(healthResponse);
});

describe('API Gateway Health Check', () => {
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
    expect(response.body.service).toBe('api-gateway');
  });

  it('should return status ok', async () => {
    const response = await request(app).get('/health');
    expect(response.body.status).toBe('ok');
  });

  it('should return version', async () => {
    const response = await request(app).get('/health');
    expect(response.body.version).toBe('1.0.0');
  });

  it('should return valid timestamp', async () => {
    const response = await request(app).get('/health');
    const timestamp = new Date(response.body.timestamp);
    expect(timestamp.getTime()).toBeGreaterThan(0);
  });

  it('should return uptime as a number', async () => {
    const response = await request(app).get('/health');
    expect(typeof response.body.uptime).toBe('number');
    expect(response.body.uptime).toBeGreaterThanOrEqual(0);
  });
});
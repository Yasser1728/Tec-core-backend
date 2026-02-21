import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.routes';
import subscriptionRoutes from './routes/subscription.routes';
import kycRoutes from './routes/kyc.routes';
import securityRoutes from './routes/security.routes';
import profileRoutes from './routes/profile.routes';

dotenv.config();

// Validate required environment variables
const requiredEnvVars = ['JWT_SECRET', 'JWT_REFRESH_SECRET'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`❌ Error: ${envVar} is required but not set in environment variables`);
    process.exit(1);
  }
}

const app: Application = express();
const PORT = process.env.PORT || 5001;
const SERVICE_VERSION = process.env.SERVICE_VERSION || '1.0.0';
const serviceStartTime = Date.now();

// Security middleware
app.use(helmet());
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:3000';
if (corsOrigin === '*' && process.env.NODE_ENV === 'production') {
  console.warn('⚠️  WARNING: CORS_ORIGIN is set to wildcard "*" in production. Set CORS_ORIGIN to your frontend URL.');
}
app.use(cors({
  origin: corsOrigin,
  credentials: true,
}));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (_req, res) => {
  const uptime = Math.floor((Date.now() - serviceStartTime) / 1000);
  
  interface HealthResponse {
    status: string;
    service: string;
    timestamp: string;
    uptime: number;
    version: string;
  }
  
  const response: HealthResponse = {
    status: 'ok',
    service: 'auth-service',
    timestamp: new Date().toISOString(),
    uptime,
    version: SERVICE_VERSION,
  };
  
  res.json(response);
});

// Routes — mounted at both paths for local dev and Vercel serverless compatibility
app.use('/auth', authRoutes);
app.use('/subscriptions', subscriptionRoutes);
app.use('/kyc', kycRoutes);
app.use('/security', securityRoutes);
app.use('/profile', profileRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/kyc', kycRoutes);
app.use('/api/security', securityRoutes);
app.use('/api/profile', profileRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Endpoint not found',
    },
  });
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Auth Service Error:', err);
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    },
  });
});

app.listen(PORT, () => {
  console.log(`🔐 Auth Service running on port ${PORT}`);
});

export default app;
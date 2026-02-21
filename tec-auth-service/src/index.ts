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

const app: Application = express();
const PORT = process.env.PORT || 5001;
const SERVICE_VERSION = process.env.SERVICE_VERSION || '1.0.0';
const serviceStartTime = Date.now();

// Security middleware
app.use(helmet());
const corsOrigin = process.env.CORS_ORIGIN || '*';
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
  res.json({
    status: 'ok',
    service: 'auth-service',
    timestamp: new Date().toISOString(),
    uptime,
    version: SERVICE_VERSION,
  });
});

// Routes
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
app.use('*', (_req, res) => {
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

// ✅ Vercel fix: only listen in local development
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🔐 Auth Service running on port ${PORT}`);
  });
}

export default app;

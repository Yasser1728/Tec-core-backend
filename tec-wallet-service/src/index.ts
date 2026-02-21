import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import walletRoutes from './routes/wallet.routes';

dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 5002;
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
    service: 'wallet-service',
    timestamp: new Date().toISOString(),
    uptime,
    version: SERVICE_VERSION,
  };
  
  res.json(response);
});

// Routes — mounted at both paths for local dev and Vercel serverless compatibility
app.use('/wallets', walletRoutes);
app.use('/api/wallets', walletRoutes);

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
  console.error('Wallet Service Error:', err);
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    },
  });
});

app.listen(PORT, () => {
  console.log(`💰 Wallet Service running on port ${PORT}`);
});

export default app;
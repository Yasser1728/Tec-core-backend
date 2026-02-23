import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import paymentRoutes from './routes/payment.routes';
import { errorMiddleware } from './middlewares/error.middleware';

const app: Application = express();

const SERVICE_VERSION = process.env.SERVICE_VERSION || '1.0.0';
const serviceStartTime = Date.now();

// ─── Security headers ─────────────────────────────────────────────────────────
app.use(helmet());

// ─── CORS ─────────────────────────────────────────────────────────────────────
const corsOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({
  origin: corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
}));

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Health check ─────────────────────────────────────────────────────────────
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

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/payments', paymentRoutes);
app.use('/api/payments', paymentRoutes);

// ─── 404 handler ──────────────────────────────────────────────────────────────
app.use('*', (_req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Endpoint not found',
    },
  });
});

// ─── Error handler ────────────────────────────────────────────────────────────
app.use(errorMiddleware);

export default app;

import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { v4 as uuidv4 } from 'uuid';
import paymentRoutes from './routes/payment.routes';
import { errorMiddleware } from './middlewares/error.middleware';

const app: Application = express();

const SERVICE_VERSION = process.env.SERVICE_VERSION || '1.0.0';
const serviceStartTime = Date.now();

// ─── Security headers ─────────────────────────────────────────────────────────
// Explicitly configure Helmet directives for defence-in-depth.
// Note: Expect-CT was removed from Helmet 7+ and deprecated by all major browsers
//       (Chrome 112+, April 2023). HSTS/certificate transparency via CAA DNS records
//       is the recommended modern alternative.
app.use(
  helmet({
    // Prevent information leakage via the Referer header
    referrerPolicy: { policy: 'no-referrer' },
    // Strict Transport Security: require HTTPS for 1 year
    strictTransportSecurity: {
      maxAge: 31536000,
      includeSubDomains: true,
    },
    // Minimal CSP for a JSON REST API — no HTML/scripts served
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    // Standard protections (on by default, made explicit here)
    xContentTypeOptions: true,
    xFrameOptions: { action: 'deny' },
    xDnsPrefetchControl: { allow: false },
  }),
);

// ─── CORS ─────────────────────────────────────────────────────────────────────
const corsOrigin = process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGIN || '*';
app.use(cors({
  origin: corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id'],
}));

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Request correlation (X-Request-Id) ──────────────────────────────────────
app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = (req.headers['x-request-id'] as string | undefined) || uuidv4();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
});

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

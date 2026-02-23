import { Request, Response, NextFunction } from 'express';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory store keyed by IP address
const store = new Map<string, RateLimitEntry>();

// Window duration in ms (default: 1 minute)
const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW || '60000', 10);
// Maximum requests per window (default: 20)
const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX || '20', 10);

// Periodically remove expired entries to prevent unbounded memory growth.
// Runs every 2× the window to reduce overhead while still bounding memory.
// .unref() ensures this timer does not block process exit
setInterval(() => {
  const now = Date.now();
  store.forEach((entry, key) => {
    if (entry.resetAt < now) {
      store.delete(key);
    }
  });
}, WINDOW_MS * 2).unref();

// Simple in-memory rate limiter for /auth endpoints
export const rateLimitMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const key = req.ip ?? 'unknown';
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt < now) {
    // Start a new window for this IP
    store.set(key, { count: 1, resetAt: now + WINDOW_MS });
    next();
    return;
  }

  if (entry.count >= MAX_REQUESTS) {
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests, please try again later',
      },
    });
    return;
  }

  entry.count++;
  next();
};

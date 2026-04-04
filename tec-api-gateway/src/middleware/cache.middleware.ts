import { Request, Response, NextFunction } from 'express';

interface CacheEntry {
  data:      unknown;
  expiresAt: number;
}

// ── In-memory cache (simple Map) ─────────────────────────
const cache = new Map<string, CacheEntry>();

// ── Cacheable routes مع TTL بالثواني ─────────────────────
const CACHE_RULES: Array<{ pattern: RegExp; ttl: number }> = [
  { pattern: /^\/health$/,                                    ttl: 30    },
  { pattern: /^\/ready$/,                                     ttl: 30    },
  { pattern: /^\/api\/v1\/commerce\/subscriptions\/plans/,    ttl: 300   },
  { pattern: /^\/api\/commerce\/subscriptions\/plans/,        ttl: 300   },
  { pattern: /^\/api\/v1\/analytics/,                        ttl: 60    },
  { pattern: /^\/api\/analytics/,                            ttl: 60    },
];

const getCacheTTL = (path: string): number | null => {
  const rule = CACHE_RULES.find(r => r.pattern.test(path));
  return rule ? rule.ttl : null;
};

const getCacheKey = (req: Request): string =>
  `${req.method}:${req.path}:${JSON.stringify(req.query)}`;

// ── Cache Middleware ──────────────────────────────────────
export const cacheMiddleware = (
  req:  Request,
  res:  Response,
  next: NextFunction,
): void => {
  // ✅ فقط GET requests
  if (req.method !== 'GET') { next(); return; }

  const ttl = getCacheTTL(req.path);
  if (!ttl) { next(); return; }

  const key   = getCacheKey(req);
  const entry = cache.get(key);

  // ✅ Cache HIT
  if (entry && entry.expiresAt > Date.now()) {
    res.setHeader('x-cache',     'HIT');
    res.setHeader('x-cache-ttl', String(Math.ceil((entry.expiresAt - Date.now()) / 1000)));
    res.json(entry.data);
    return;
  }

  // ✅ Cache MISS — intercept الـ response
  const originalJson = res.json.bind(res);
  res.json = (data: unknown) => {
    if (res.statusCode === 200) {
      cache.set(key, {
        data,
        expiresAt: Date.now() + ttl * 1000,
      });
    }
    res.setHeader('x-cache', 'MISS');
    return originalJson(data);
  };

  next();
};

// ── Cache invalidation ────────────────────────────────────
export const invalidateCache = (pattern?: RegExp): void => {
  if (!pattern) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (pattern.test(key)) cache.delete(key);
  }
};

// ── Cache stats ───────────────────────────────────────────
export const getCacheStats = () => ({
  size:    cache.size,
  entries: Array.from(cache.keys()),
});

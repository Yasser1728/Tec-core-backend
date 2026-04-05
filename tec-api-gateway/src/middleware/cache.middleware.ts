import { Request, Response, NextFunction } from 'express';

interface CacheEntry {
  data:      unknown;
  expiresAt: number;
}

// ── LRU Cache — max 500 entries ───────────────────────────
const MAX_CACHE_SIZE = 500;

class LRUCache {
  private map  = new Map<string, CacheEntry>();
  private max:   number;

  constructor(max: number) {
    this.max = max;
  }

  get(key: string): CacheEntry | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    // ✅ LRU — انقل للآخر (most recently used)
    this.map.delete(key);
    this.map.set(key, entry);
    return entry;
  }

  set(key: string, value: CacheEntry): void {
    // ✅ لو الـ key موجود — احذفه عشان نعيد ترتيبه
    if (this.map.has(key)) this.map.delete(key);

    // ✅ لو وصلنا للـ max — احذف الـ oldest entry
    if (this.map.size >= this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest) this.map.delete(oldest);
    }

    this.map.set(key, value);
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }

  keys(): IterableIterator<string> {
    return this.map.keys();
  }
}

// ── Cache instance ────────────────────────────────────────
const cache = new LRUCache(MAX_CACHE_SIZE);

// ── Periodic cleanup — كل 5 دقايق ────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const key of cache.keys()) {
    const entry = cache.get(key);
    if (entry && entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
}, 5 * 60 * 1000);

// ── Cacheable routes مع TTL بالثواني ─────────────────────
const CACHE_RULES: Array<{ pattern: RegExp; ttl: number }> = [
  { pattern: /^\/health$/,                                 ttl: 30  },
  { pattern: /^\/ready$/,                                  ttl: 30  },
  { pattern: /^\/api\/v1\/commerce\/subscriptions\/plans/, ttl: 300 },
  { pattern: /^\/api\/commerce\/subscriptions\/plans/,     ttl: 300 },
  { pattern: /^\/api\/v1\/analytics/,                      ttl: 60  },
  { pattern: /^\/api\/analytics/,                          ttl: 60  },
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

  // ✅ Cache MISS
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
  if (!pattern) { cache.clear(); return; }
  for (const key of cache.keys()) {
    if (pattern.test(key)) cache.delete(key);
  }
};

// ── Cache stats ───────────────────────────────────────────
export const getCacheStats = () => ({
  size:       cache.size,
  maxSize:    MAX_CACHE_SIZE,
  entries:    Array.from(cache.keys()),
});

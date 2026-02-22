# TEC API Gateway

Central entry point for all TEC platform microservices. Receives all incoming HTTP requests and reverse-proxies them to the appropriate downstream service.

## Architecture

```
Client
  │
  ▼
API Gateway  (PORT 3000)
  ├─ /api/auth/*      ──▶  Auth Service
  ├─ /api/wallets/*   ──▶  Wallet Service
  └─ /api/payments/*  ──▶  Payment Service
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3000` | Port the gateway listens on (Railway sets this automatically) |
| `NODE_ENV` | No | `development` | Set to `production` on Railway |
| `AUTH_SERVICE_URL` | Yes | `http://localhost:5001` | Full URL of the Auth Service |
| `WALLET_SERVICE_URL` | Yes | `http://localhost:5002` | Full URL of the Wallet Service |
| `PAYMENT_SERVICE_URL` | Yes | `http://localhost:5003` | Full URL of the Payment Service |
| `CORS_ORIGIN` | No | `*` | Allowed CORS origin (set to your frontend URL) |
| `RATE_LIMIT_WINDOW_MS` | No | `900000` | Rate-limit window in milliseconds (15 min) |
| `RATE_LIMIT_MAX_REQUESTS` | No | `100` | Max requests per window per IP |
| `LOG_LEVEL` | No | `info` | Log level (`error`, `warn`, `info`, `debug`) |
| `SERVICE_VERSION` | No | `1.0.0` | Version shown in `/health` response |

Copy `.env.example` to `.env` and fill in values before running locally.

## Railway Deployment

1. Create a new **Service** in your Railway project pointing to this directory.
2. Set the environment variables above in the Railway service settings.
3. Set `AUTH_SERVICE_URL`, `WALLET_SERVICE_URL`, and `PAYMENT_SERVICE_URL` to the public Railway URLs of the corresponding services.
4. Railway exposes the service at `https://<your-service>.up.railway.app`.

> **Note:** Railway automatically sets `PORT`. Do not hard-code a port.

## API Routes

| Method | Path | Proxies to |
|---|---|---|
| `GET` | `/health` | Gateway health (checks all downstream services) |
| `*` | `/api/auth/*` | Auth Service |
| `*` | `/api/wallets/*` | Wallet Service |
| `*` | `/api/payments/*` | Payment Service |

## Testing the Service

### Health check
```bash
curl https://tec-core-backend-pi.up.railway.app/health
```

Expected response:
```json
{
  "status": "ok",
  "service": "api-gateway",
  "timestamp": "...",
  "uptime": 42,
  "version": "1.0.0",
  "services": {
    "auth-service": { "status": "ok", "version": "1.0.0" },
    "wallet-service": { "status": "ok", "version": "1.0.0" },
    "payment-service": { "status": "ok", "version": "1.0.0" }
  }
}
```

If any downstream service is unreachable, the top-level `status` becomes `"degraded"`.

### Proxy a request through the gateway
```bash
curl -X POST https://tec-core-backend-pi.up.railway.app/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","username":"testuser","password":"securepassword"}'
```

## Local Development

```bash
# Install dependencies
npm install

# Start in watch mode
npm run dev

# Build
npm run build

# Run tests
npm test
```

## Quality Notes

- Rate limiting is applied globally before the proxy middleware.
- The `/health` endpoint performs active health checks on all downstream services with a 2-second timeout per service.
- All proxy errors return a structured `503 SERVICE_UNAVAILABLE` response.

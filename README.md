# Tec-core-backend

Monorepo for the TEC Ecosystem backend — 12 independent Node.js/TypeScript microservices deployed on [Railway](https://railway.app).

| Service | Directory | Port | Description |
|---------|-----------|------|-------------|
| API Gateway | `tec-api-gateway` | 3000 | Single entry point — proxies all requests |
| Auth Service | `tec-auth-service` | 5001 | Pi Network auth + JWT |
| Wallet Service | `tec-wallet-service` | 5002 | Balances + transactions |
| Payment Service | `tec-payment-service` | 5003 | Pi payment lifecycle + Outbox |
| Asset Service | `tec-asset-service` | 5004 | Digital asset ledger |
| Storage Service | `tec-storage-service` | 5005 | Cloudflare R2 |
| Commerce Service | `tec-commerce-service` | 5006 | Orders + checkout |
| Notification Service | `tec-notification-service` | 5007 | Push notifications |
| KYC Service | `tec-kyc-service` | 5008 | Identity verification |
| Identity Service | `tec-identity-service` | 5009 | User profiles |
| Realtime Service | `tec-realtime-service` | 5010 | WebSocket + Redis Streams |
| Analytics Service | `tec-analytics-service` | 5011 | Events + daily metrics |

---

## Architecture
┌─────────────────────────────────────────────────────────┐
│                Frontend (Next.js 15)                    │
│              tec-app.vercel.app                         │
└──────────────────────────┬──────────────────────────────┘
│ HTTPS
▼
┌──────────────────────────────────────────────────────────┐
│              API Gateway (:3000)                         │
│  CORS · Rate Limiting · Helmet · x-internal-key          │
├────────┬────────┬────────┬────────┬────────┬────────────┤
│  auth  │ wallet │payment │ assets │  kyc   │ commerce   │
└───┬────┴───┬────┴───┬────┴───┬────┴───┬────┴───┬────────┘
▼        ▼        ▼        ▼        ▼        ▼
[:5001]  [:5002]  [:5003]  [:5004]  [:5008]  [:5006]
│        │        │
▼        ▼        ▼
[PostgreSQL x 6]  [Supabase]
(Analytics)
### Event Flow
User → Frontend → SDK → Gateway → Payment Service
↓
Pi Network API
↓
Outbox Pattern
↓
Redis Streams
┌─────────────┴──────────────┐
Wallet Service            Notification Service
(credit balance)          (push notification)
↓                           ↓
Analytics Service         Realtime Service
(track event)             (WebSocket → Frontend)
### Patterns Used

| Pattern | Service | Purpose |
|---------|---------|---------|
| Outbox | Payment | Guaranteed event delivery |
| Idempotency | Payment + Wallet | Duplicate prevention |
| Circuit Breaker | Payment | Pi API protection |
| Saga | Payment | Distributed transaction |
| Redis Pub/Sub | All | Loose coupling |

---

## Live URLs
API Gateway:   https://api-gateway-production-6a68.up.railway.app
Auth:          https://auth-service-pi.up.railway.app
Payment:       https://payment-service-production-90e5.up.railway.app
Wallet:        https://wallet-service-production-445d.up.railway.app
Asset:         https://asset-service-production-54c4.up.railway.app
Commerce:      https://commerce-service-production.up.railway.app
Notification:  https://notification-service-production-dc81.up.railway.app
KYC:           https://kyc-service-production-ba73.up.railway.app
Identity:      https://identity-service-production-fe57.up.railway.app
Storage:       https://storage-sevice-production.up.railway.app
Realtime:      https://realtime-service-production-9630.up.railway.app
---

## API Reference

All endpoints via API Gateway: `https://api-gateway-production-6a68.up.railway.app`

### Gateway

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Aggregated health check |
| `GET` | `/ready` | Readiness probe |
| `GET` | `/metrics` | Prometheus metrics |

### Auth (`/api/auth/*`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/auth/pi-login` | No | Login via Pi Network SDK |
| `POST` | `/api/auth/refresh` | No | Refresh access token |
| `GET` | `/api/auth/me` | Yes | Get current user |
| `POST` | `/api/auth/logout` | Yes | Invalidate session |

### Payment (`/api/payment/*`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/payment/create` | Yes | Create payment |
| `POST` | `/api/payment/approve` | Yes | Approve with Pi Network |
| `POST` | `/api/payment/complete` | Yes | Complete + emit event |
| `POST` | `/api/payment/cancel` | Yes | Cancel payment |
| `GET` | `/api/payment/status/:id` | Yes | Get payment status |
| `GET` | `/api/payment/history` | Yes | Paginated history |
| `POST` | `/api/payment/reconcile` | Internal | Reconcile stale payments |

### Wallet (`/api/wallet/*`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/wallets` | Internal | List wallets by userId |
| `GET` | `/wallets/:id/balance` | Internal | Get balance |
| `GET` | `/wallets/:id/transactions` | Internal | Transaction history |
| `POST` | `/wallets/:id/deposit` | Yes | Deposit funds |
| `POST` | `/wallets/:id/withdraw` | Yes | Withdraw funds |
| `POST` | `/wallets/transfer` | Yes | Transfer between wallets |
| `POST` | `/wallets/internal/add-funds` | Internal | Credit from payment event |

### Assets (`/api/assets/*`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/assets/provision` | Yes | Provision new asset |
| `GET` | `/api/assets/:slug` | Yes | Get asset by slug |
| `GET` | `/api/assets/user/:userId` | Yes | Get user assets |

### KYC (`/api/kyc/*`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/kyc/status` | Yes | KYC status |
| `POST` | `/api/kyc/submit` | Yes | Submit KYC |
| `POST` | `/api/kyc/verify` | Admin | Approve/reject |

### Commerce (`/api/commerce/*`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/commerce/orders` | Yes | List orders |
| `POST` | `/api/commerce/orders` | Yes | Create order |
| `POST` | `/api/commerce/orders/checkout` | Yes | Checkout |

### Analytics (`/api/analytics/*`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/analytics/overview` | No | Overview metrics |
| `GET` | `/api/analytics/payments` | No | Payment analytics |
| `GET` | `/api/analytics/users` | No | User analytics |
| `GET` | `/api/analytics/events` | No | Recent events |

---

## Environment Variables

### Common (all services)
```env
NODE_ENV=production
PORT=<service-port>
DATABASE_URL=postgresql://...
INTERNAL_SECRET=<shared-strong-secret>
REDIS_URL=redis://...
API Gateway
AUTH_SERVICE_URL=https://auth-service-pi.up.railway.app
PAYMENT_SERVICE_URL=https://payment-service-production-90e5.up.railway.app
WALLET_SERVICE_URL=https://wallet-service-production-445d.up.railway.app
ASSET_SERVICE_URL=https://asset-service-production-54c4.up.railway.app
COMMERCE_SERVICE_URL=https://commerce-service-production.up.railway.app
NOTIFICATION_SERVICE_URL=https://notification-service-production-dc81.up.railway.app
KYC_SERVICE_URL=https://kyc-service-production-ba73.up.railway.app
IDENTITY_SERVICE_URL=https://identity-service-production-fe57.up.railway.app
REALTIME_SERVICE_URL=https://realtime-service-production-9630.up.railway.app
ANALYTICS_SERVICE_URL=https://analytics-service-production-c310.up.railway.app
ALLOWED_ORIGINS=https://tec-app.vercel.app,https://*.vercel.app
Auth + Payment
JWT_SECRET=<generate: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">
JWT_REFRESH_SECRET=<different-strong-secret>
JWT_EXPIRES_IN=24h
Payment Service
PI_API_KEY=<from developers.minepi.com>
PI_APP_ID=tec-app-de161fa2243c797b
PI_SANDBOX=false
Storage Service
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=tec-storage
Analytics Service
DATABASE_URL=postgresql://...  # Supabase Transaction Pooler
DIRECT_URL=postgresql://...    # Supabase Direct Connection
Key Rules
// ✅ Prisma import — relative path
import { PrismaClient } from '../prisma/client';

// ✅ Internal service auth
headers: { 'x-internal-key': process.env.INTERNAL_SECRET }

// ✅ JWT secret from env only
const secret = process.env.JWT_SECRET;

// ✅ Use SDK not direct API
import { TecSDK } from '@yasser172/tec-sdk';
CI/CD Pipeline
push to main
      ↓
lint-and-test  (8 services, parallel)
      ↓
coverage-gate  (payment + wallet, 60% threshold)
      ↓
docker-build   (8 services, parallel)
      ↓
migrate        (Prisma migrations, sequential)
      ↓
deploy         (Railway, 4 parallel)
Required secret: RAILWAY_TOKEN — generate from Railway account settings.
Testing
# Unit tests
npm test

# Coverage report
npm run test:coverage

# Integration tests
npm test -- --testPathPattern=integration

# E2E (frontend)
cd tec-frontend && npm run test:e2e
Coverage Thresholds
Service
Lines
Branches
Payment
60%
50%
Wallet
60%
50%
Local Development
git clone https://github.com/Yasser1728/Tec-core-backend
cd Tec-core-backend

# Setup a service
cd tec-payment-service
cp .env.example .env
npm install
npx prisma generate
npx prisma db push
npm run dev
Each service runs independently. Start all services in separate terminals for full E2E testing.
Pi Sandbox
Setting
Value
App ID
tec-app-de161fa2243c797b
Sandbox URL
https://sandbox.minepi.com/app/tec-app-de161fa2243c797b
Allowed domains:
https://tec-app.vercel.app
https://api-gateway-production-6a68.up.railway.app
Repositories
Repo
Description
Tec-core-backend
Backend microservices
Tec-App
Next.js 15 frontend
TEC-SDK
@yasser172/tec-sdk
Status
Overall:  8.8/10
Backend:  85% production-ready
Frontend: 65% complete
Tests:    100+ test cases
CI/CD:    8 services automated
Engineering Notes
Internal DNS: In production use http://<service>.railway.internal:<port> to keep traffic on Railway's private network.
CORS: Gateway handles CORS. Downstream services keep ALLOWED_ORIGINS empty.
Rate Limiting: Applied at gateway level — 100 req/15 min per IP.
Health Checks: Every service exposes GET /health → { status, service, uptime }.
Idempotency: Payment and Wallet services use Idempotency-Key header to prevent duplicate processing.
Outbox Pattern: Payment service writes events to DB before publishing to Redis — guarantees delivery even if Redis is down.
Built with ❤️ by the TEC Team — Powered by Pi Network

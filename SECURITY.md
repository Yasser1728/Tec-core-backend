# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x.x   | ✅ |

## Reporting a Vulnerability

If you discover a security vulnerability in TEC Ecosystem, please report it responsibly:

1. **Do NOT** open a public GitHub issue
2. Email: security@tec-ecosystem.com
3. Include a detailed description of the vulnerability
4. Allow up to 48 hours for an initial response

We take all security reports seriously and will respond promptly.

---

## Security Architecture

### Authentication
- All user-facing endpoints require a valid **JWT** (`Authorization: Bearer <token>`)
- Tokens are signed with `HS256` and validated on every request
- `clockTolerance` is configurable via `JWT_CLOCK_TOLERANCE` env var
- Refresh tokens are stored securely and rotated on use

### Internal Service Auth
- All inter-service communication requires `x-internal-key` header
- Value must match `INTERNAL_SECRET` env var (shared across all services)
- Requests missing or with wrong key return `403 Forbidden`
- Prevents direct access to downstream services bypassing the Gateway

### Pi Network Auth
- Login is handled exclusively via **Pi Network SDK**
- Pi UID is verified against `api.minepi.com/v2/me`
- No passwords stored — Pi Network handles identity

---

## Security Measures

### API Gateway
- **Rate Limiting** — 100 req / 15 min per IP (express-rate-limit)
- **Helmet** — security headers on all responses
- **CORS** — restricted to `tec-app.vercel.app` + `*.vercel.app`
- **Request ID** — every request gets a UUID for tracing

### Payment Service
- **Idempotency** — `Idempotency-Key` header prevents duplicate payments
- **Outbox Pattern** — events written to DB before Redis publish
- **Circuit Breaker** — Pi API failures don't cascade
- **State Machine** — invalid payment transitions rejected
- **Reconciliation** — stale payments auto-reconciled hourly

### Wallet Service
- **Balance Checks** — withdraw/transfer validate balance before commit
- **Atomic Transactions** — Prisma `$transaction` for all balance changes
- **Audit Log** — every balance change recorded with before/after state
- **Double-spend Prevention** — concurrent requests handled via DB locks

### Data
- **Prisma ORM** — parameterized queries, no raw SQL injection risk
- **Secrets** — never committed to code, always from env vars
- **Cloudflare R2** — storage with signed URLs
- **Supabase** — analytics DB with connection pooling

### Monitoring
- **Dependabot** — automated dependency updates
- **CodeQL** — GitHub code scanning on every push
- **Sentry** — runtime error tracking in production
- **CI/CD** — all code goes through lint + test + build before deploy

---

## Environment Variables Security

```bash
# ✅ Generate strong secrets
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Never commit these to code:
JWT_SECRET=
JWT_REFRESH_SECRET=
INTERNAL_SECRET=
PI_API_KEY=
R2_SECRET_ACCESS_KEY=
DATABASE_URL=
All secrets are stored in Railway environment variables, never in .env files committed to the repository.
Known Security Controls by Service
Service
Auth
Rate Limit
Audit Log
Idempotency
API Gateway
x-internal-key
✅ 100/15min
—
—
Auth Service
JWT
✅
✅
—
Payment Service
JWT + x-internal-key
✅
✅
✅
Wallet Service
JWT + x-internal-key
✅
✅
✅
Asset Service
JWT + x-internal-key
✅
—
—
KYC Service
JWT + x-internal-key
✅
✅
—
Commerce Service
JWT + x-internal-key
✅
—
—
Notification Service
x-internal-key
✅
—
—
Realtime Service
JWT (WebSocket)
—
—
—
Analytics Service
x-internal-key
✅
—
—
Disclosure Policy
We follow responsible disclosure. Once a fix is deployed, we will publicly acknowledge the reporter unless anonymity is requested.
Response SLA:
Initial response: 48 hours
Patch for critical: 7 days
Patch for high: 14 days
Patch for medium/low: 30 days
---

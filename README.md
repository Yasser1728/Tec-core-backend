# Tec-core-backend

Monorepo for the TEC platform backend — four independent Node.js/TypeScript microservices deployed on [Railway](https://railway.app).

| Service | Directory | Default Port | Description |
|---|---|---|---|
| API Gateway | `tec-api-gateway` | 3000 | Single entry point; proxies requests to downstream services |
| Auth Service | `tec-auth-service` | 5001 | User auth, KYC, 2FA, profiles, subscriptions |
| Wallet Service | `tec-wallet-service` | 5002 | Wallet linking, balances, transaction history |
| Payment Service | `tec-payment-service` | 5003 | Pi/card/wallet payment lifecycle |

## Live Base URL

```
https://tec-core-backend-pi.up.railway.app
```

All requests pass through the API Gateway. Example:

```bash
# Health check
curl https://tec-core-backend-pi.up.railway.app/health

# Register a user (proxied to auth-service)
curl -X POST https://tec-core-backend-pi.up.railway.app/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","username":"myuser","password":"StrongPass1!"}'
```

## Service-level Documentation

- [API Gateway →](tec-api-gateway/README.md)
- [Auth Service →](tec-auth-service/README.md)
- [Wallet Service →](tec-wallet-service/README.md)
- [Payment Service →](tec-payment-service/README.md)

## Railway Deployment

Each service is deployed as a separate Railway **Service** within the same project.

### Steps

1. Create a new [Railway project](https://railway.app/new).
2. For each of the four services, click **Add Service → GitHub Repo** and select this repository. Set the **Root Directory** to the service's folder (e.g. `tec-api-gateway`).
3. Attach a **PostgreSQL** plugin to the project. Railway will inject `DATABASE_URL` into services that need it automatically.
4. Configure the environment variables listed in each service's `.env.example` file via the Railway dashboard.
5. **Internal DNS:** Set `AUTH_SERVICE_URL`, `WALLET_SERVICE_URL`, and `PAYMENT_SERVICE_URL` in the API Gateway to the Railway internal DNS addresses (e.g. `http://auth-service.railway.internal:5001`) so traffic stays on Railway's private network.
6. **Internal secret:** Generate a strong secret and set `INTERNAL_SECRET` to the same value in the Gateway and all three downstream services. This prevents direct access to downstream services that bypass the Gateway.

### Recommended environment variables per service

#### API Gateway
```env
NODE_ENV=production
AUTH_SERVICE_URL=http://auth-service.railway.internal:5001
WALLET_SERVICE_URL=http://wallet-service.railway.internal:5002
PAYMENT_SERVICE_URL=http://payment-service.railway.internal:5003
INTERNAL_SECRET=<strong-random-hex — must match the value set in each downstream service>
ALLOWED_ORIGINS=https://tec-app.vercel.app,https://*.vercel.app
```

#### Auth Service
```env
NODE_ENV=production
JWT_SECRET=<generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">
JWT_REFRESH_SECRET=<different strong random string>
INTERNAL_SECRET=<same value as gateway>
ALLOWED_ORIGINS=
```

#### Wallet Service
```env
NODE_ENV=production
INTERNAL_SECRET=<same value as gateway>
ALLOWED_ORIGINS=
```

#### Payment Service
```env
NODE_ENV=production
JWT_SECRET=<same value as auth-service>
PI_API_KEY=<from https://developers.minepi.com>
PI_APP_ID=<from https://developers.minepi.com>
PI_SANDBOX=true
INTERNAL_SECRET=<same value as gateway>
ALLOWED_ORIGINS=
```

> **Tip:** Railway automatically injects the `PORT` variable. Never hard-code a port number.

## Local Development

Each service can be run independently.

```bash
# Example for tec-auth-service
cd tec-auth-service
cp .env.example .env          # fill in values
npm install
npm run dev
```

To run all services simultaneously, open four terminals (one per service).

## CI/CD

Two GitHub Actions workflows run automatically on every push and pull request to `main`/`master`:

### 1. CI Workflow (`.github/workflows/ci.yml`)

1. **Lint & Test** — runs `npm run lint`, `npm run build`, and `npm test` for each service in parallel.
2. **Docker Build** — builds each service's Docker image (no push) to verify the `Dockerfile` is correct.

### 2. Railway Deployment (`.github/workflows/railway-deploy.yml`)

Automatically deploys to Railway on every push to `main`/`master` using the official [`railwayapp/railway-github-deploy`](https://github.com/railwayapp/railway-github-deploy) action.

**Required secret:**

| Secret | Description |
|--------|-------------|
| `RAILWAY_TOKEN` | Railway API token. Generate one from your [Railway account settings](https://railway.app/account/tokens) and add it as a repository secret under **Settings → Secrets and variables → Actions**. |

The **Railway Deployment** check will appear alongside the CI and other checks in every pull request and push.

## Pi Sandbox Setup

The Payment Service is pre-configured for the Pi Network sandbox environment.

| Setting | Value |
|---|---|
| Pi App ID | `tec-app-de161fa2243c797b` |
| Pi Sandbox App URL | https://sandbox.minepi.com/app/tec-app-de161fa2243c797b |

**Allowed domains (Pi Developer Portal):**
- `https://tec-app.vercel.app`
- `https://sandbox.minepi.com/app/tec-app-de161fa2243c797b`
- `https://api-gateway-production-6a68.up.railway.app`

**Required env keys in `tec-payment-service`:**

```env
PI_APP_ID=tec-app-de161fa2243c797b
PI_SANDBOX=true
PI_API_KEY=          # obtain from https://developers.minepi.com — never commit real key
PI_TEST_WALLET=GCVMCQN56ZZGSA6KKT3S6INXHEWPK4CTGWU7AGCEHP5KWSHDL4SJY7CI
```

> **Note:** `PI_API_KEY` is a secret — set it in Railway (or your `.env`) only; do not commit a real value.

## Engineering Notes

- **No Vercel dependency:** `vercel.json` exists for historical reference but the primary deployment target is Railway. All services now always start their HTTP server regardless of `NODE_ENV`.
- **Dockerfiles are self-contained:** each service's `Dockerfile` uses its own directory as the build context, compatible with Railway's per-service build.
- **Health checks:** every service exposes `GET /health` returning `{ status, service, uptime, version }`. The API Gateway aggregates health from all downstream services.
- **Internal auth (`INTERNAL_SECRET`):** the Gateway injects an `x-internal-key` header (value: `INTERNAL_SECRET`) on every proxied request. Each downstream service (auth/wallet/payment) validates this header and rejects requests with 403 when the secret is configured but missing or wrong. This prevents direct access to downstream services by anyone who has not gone through the Gateway. Generate a strong secret with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and set the same value in all four services.
- **CORS:** defaults to *deny all cross-origin requests* (empty `ALLOWED_ORIGINS`). In production, set `ALLOWED_ORIGINS` on the Gateway to your frontend domain and desired preview patterns (e.g. `https://tec-app.vercel.app,https://*.vercel.app`). Downstream services should keep `ALLOWED_ORIGINS` empty because all legitimate browser traffic arrives via the Gateway.
- **Internal DNS:** in production (Railway) prefer `http://<service>.railway.internal:<port>` as service URLs in the Gateway so traffic stays on Railway's private network and is not charged as egress.
- **Rate limiting:** applied at the gateway level (100 req / 15 min per IP by default).

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
5. Set the `AUTH_SERVICE_URL`, `WALLET_SERVICE_URL`, and `PAYMENT_SERVICE_URL` variables in the API Gateway to the public URLs of the corresponding Railway services.

### Recommended environment variables per service

#### API Gateway
```env
NODE_ENV=production
AUTH_SERVICE_URL=https://<auth-service>.up.railway.app
WALLET_SERVICE_URL=https://<wallet-service>.up.railway.app
PAYMENT_SERVICE_URL=https://<payment-service>.up.railway.app
CORS_ORIGIN=*
```

#### Auth Service
```env
NODE_ENV=production
JWT_SECRET=<generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">
JWT_REFRESH_SECRET=<different strong random string>
CORS_ORIGIN=https://tec-core-backend-pi.up.railway.app
```

#### Wallet Service
```env
NODE_ENV=production
CORS_ORIGIN=https://tec-core-backend-pi.up.railway.app
```

#### Payment Service
```env
NODE_ENV=production
JWT_SECRET=<same value as auth-service>
PI_API_KEY=<from https://developers.minepi.com>
PI_APP_ID=<from https://developers.minepi.com>
PI_SANDBOX=true
CORS_ORIGIN=https://tec-core-backend-pi.up.railway.app
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

## Engineering Notes

- **No Vercel dependency:** `vercel.json` exists for historical reference but the primary deployment target is Railway. All services now always start their HTTP server regardless of `NODE_ENV`.
- **Dockerfiles are self-contained:** each service's `Dockerfile` uses its own directory as the build context, compatible with Railway's per-service build.
- **Health checks:** every service exposes `GET /health` returning `{ status, service, uptime, version }`. The API Gateway aggregates health from all downstream services.
- **CORS:** defaults to `*` (open). In production, set `CORS_ORIGIN` to your exact frontend domain.
- **Rate limiting:** applied at the gateway level (100 req / 15 min per IP by default).

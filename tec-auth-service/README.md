# TEC Auth Service

Handles user registration, authentication, session management, KYC verification, security (2FA, devices, sessions), and user profiles.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `5001` | Port the service listens on (Railway sets this automatically) |
| `NODE_ENV` | No | `development` | Set to `production` on Railway |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string. On Railway, attach a PostgreSQL plugin and copy its `DATABASE_URL`. |
| `JWT_SECRET` | Yes | — | Secret for signing access tokens. Generate: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `JWT_REFRESH_SECRET` | Yes | — | Secret for signing refresh tokens (use a different value than `JWT_SECRET`) |
| `JWT_EXPIRES_IN` | No | `1h` | Access token lifetime (e.g. `15m`, `1h`, `24h`) |
| `JWT_REFRESH_EXPIRES_IN` | No | `7d` | Refresh token lifetime |
| `CORS_ORIGIN` | No | `*` | Allowed CORS origin. Set to your gateway or frontend URL. |
| `LOG_LEVEL` | No | `info` | Log level (`error`, `warn`, `info`, `debug`) |
| `SERVICE_VERSION` | No | `1.0.0` | Version shown in `/health` response |

Copy `.env.example` to `.env` and fill in values before running locally.

## Railway Deployment

1. Create a **Service** in your Railway project pointing to the `tec-auth-service` directory.
2. Attach a **PostgreSQL** plugin to the project; Railway injects `DATABASE_URL` automatically.
3. Set `JWT_SECRET` and `JWT_REFRESH_SECRET` in the service environment variables.
4. Set `CORS_ORIGIN` to the URL of your API Gateway or frontend.
5. The service is built from the included `Dockerfile`.

## API Routes

All routes are also available under the `/api` prefix (e.g., `/api/auth/register`).

### Authentication (`/auth`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/register` | No | Register a new user |
| `POST` | `/auth/login` | No | Login and receive tokens |
| `POST` | `/auth/logout` | Yes | Invalidate current session |
| `POST` | `/auth/refresh` | No | Refresh access token using refresh token |
| `GET` | `/auth/me` | Yes | Get current authenticated user |

### Subscriptions (`/subscriptions`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/subscriptions/plans` | No | List available subscription plans |
| `GET` | `/subscriptions/status` | Yes | Get current user's subscription status |
| `POST` | `/subscriptions/subscribe` | Yes | Subscribe to a plan |
| `POST` | `/subscriptions/cancel` | Yes | Cancel current subscription |
| `POST` | `/subscriptions/upgrade` | Yes | Upgrade to a higher plan |

### KYC (`/kyc`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/kyc/status` | Yes | Get KYC verification status |
| `POST` | `/kyc/submit` | Yes | Submit KYC verification data |
| `POST` | `/kyc/verify` | Yes (admin) | Approve or reject a KYC submission |

### Security (`/security`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/security/2fa/status` | Yes | Get 2FA status |
| `POST` | `/security/2fa/enable` | Yes | Enable 2FA |
| `POST` | `/security/2fa/verify` | Yes | Verify a 2FA code |
| `POST` | `/security/2fa/disable` | Yes | Disable 2FA |
| `GET` | `/security/devices` | Yes | List trusted devices |
| `DELETE` | `/security/devices/:id` | Yes | Remove a trusted device |
| `GET` | `/security/sessions` | Yes | List active sessions |
| `DELETE` | `/security/sessions/:id` | Yes | Revoke a session |

### Profile (`/profile`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/profile` | Yes | Get user profile |
| `PUT` | `/profile` | Yes | Update email or username |
| `PUT` | `/profile/password` | Yes | Change password |
| `DELETE` | `/profile` | Yes | Delete account |

## Testing the Service

### Health check
```bash
curl https://<auth-service>.up.railway.app/health
```

### Register a new user
```bash
curl -X POST https://<auth-service>.up.railway.app/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","username":"myuser","password":"StrongPass1!"}'
```

### Login
```bash
curl -X POST https://<auth-service>.up.railway.app/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"StrongPass1!"}'
```

The response includes `accessToken` and `refreshToken`. Pass the access token as `Authorization: Bearer <token>` on subsequent requests.

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

- Passwords are hashed with bcrypt before storage.
- All public endpoints are validated with `express-validator`.
- JWT secrets have no default values — the service will not work without them.

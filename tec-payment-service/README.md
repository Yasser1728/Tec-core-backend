# TEC Payment Service

Manages payment lifecycle: creation, approval, completion, cancellation, and failure recording. Supports Pi Network payments, card, and wallet-based payments.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `5003` | Port the service listens on (Railway sets this automatically) |
| `NODE_ENV` | No | `development` | Set to `production` on Railway |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string. On Railway, attach a PostgreSQL plugin and copy its `DATABASE_URL`. |
| `JWT_SECRET` | Yes | — | Must match the secret used in auth-service to validate bearer tokens. |
| `PI_API_KEY` | Yes (Pi) | — | Pi Network developer API key from https://developers.minepi.com |
| `PI_APP_ID` | Yes (Pi) | — | Pi Network app ID |
| `PI_SANDBOX` | No | `true` | `true` for Testnet/Sandbox, `false` for Mainnet/Production |
| `CORS_ORIGIN` | No | `*` | Allowed CORS origin. Set to your gateway or frontend URL. |
| `LOG_LEVEL` | No | `info` | Log level (`error`, `warn`, `info`, `debug`) |
| `SERVICE_VERSION` | No | `1.0.0` | Version shown in `/health` response |
| `PI_API_APPROVE_TIMEOUT` | No | `30000` | Milliseconds before Pi approval request times out |
| `PI_API_COMPLETE_TIMEOUT` | No | `30000` | Milliseconds before Pi completion request times out |

Copy `.env.example` to `.env` and fill in values before running locally.

## Railway Deployment

1. Create a **Service** in your Railway project pointing to the `tec-payment-service` directory.
2. Attach a **PostgreSQL** plugin; Railway injects `DATABASE_URL` automatically.
3. Set `JWT_SECRET` to the same value used in your auth-service.
4. Set `PI_API_KEY` and `PI_APP_ID` from your Pi Developer Portal.
5. Set `PI_SANDBOX=false` when deploying to production (Mainnet).
6. The service is built from the included `Dockerfile`.

## API Routes

All routes are also available under the `/api` prefix (e.g., `/api/payments/create`).

### Payments (`/payments`)

| Method | Path | Description |
|---|---|---|
| `POST` | `/payments/create` | Create a new payment |
| `POST` | `/payments/approve` | Approve a pending payment (second stage) |
| `POST` | `/payments/complete` | Complete an approved payment (final stage) |
| `POST` | `/payments/cancel` | Cancel a payment |
| `POST` | `/payments/fail` | Record a payment failure |
| `GET` | `/payments/:id/status` | Get the status of a payment |

### Payment Lifecycle

```
create → approve → complete
                ↘ cancel / fail
```

## Testing the Service

### Health check
```bash
curl https://<payment-service>.up.railway.app/health
```

### Create a payment
```bash
curl -X POST https://<payment-service>.up.railway.app/payments/create \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "550e8400-e29b-41d4-a716-446655440000",
    "amount": 3.14,
    "currency": "PI",
    "payment_method": "pi"
  }'
```

### Approve a payment
```bash
curl -X POST https://<payment-service>.up.railway.app/payments/approve \
  -H "Content-Type: application/json" \
  -d '{"payment_id": "<uuid>", "pi_payment_id": "<pi-txn-id>"}'
```

### Complete a payment
```bash
curl -X POST https://<payment-service>.up.railway.app/payments/complete \
  -H "Content-Type: application/json" \
  -d '{"payment_id": "<uuid>", "transaction_id": "<txn-id>"}'
```

### Get payment status
```bash
curl https://<payment-service>.up.railway.app/payments/<uuid>/status
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

- All request bodies are validated with `express-validator` before reaching controllers.
- `payment_method` must be one of: `pi`, `card`, `wallet`.
- `userId` and `payment_id` fields must be valid UUIDs.
- `PI_SANDBOX=true` connects to the Pi Testnet — never use production keys in sandbox mode.

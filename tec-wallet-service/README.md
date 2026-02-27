# TEC Wallet Service

Manages user wallets: linking new wallets, retrieving balances, and querying paginated transaction history. Supports Pi, crypto, and fiat wallet types.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `5002` | Port the service listens on (Railway sets this automatically) |
| `NODE_ENV` | No | `development` | Set to `production` on Railway |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string. On Railway, attach a PostgreSQL plugin and copy its `DATABASE_URL`. |
| `CORS_ORIGIN` | No | `*` | Allowed CORS origin. Set to your gateway or frontend URL. |
| `LOG_LEVEL` | No | `info` | Log level (`error`, `warn`, `info`, `debug`) |
| `SERVICE_VERSION` | No | `1.0.0` | Version shown in `/health` response |

Copy `.env.example` to `.env` and fill in values before running locally.

## Railway Deployment

1. Create a **Service** in your Railway project pointing to the `tec-wallet-service` directory.
2. Attach a **PostgreSQL** plugin; Railway injects `DATABASE_URL` automatically.
3. Set `CORS_ORIGIN` to the URL of your API Gateway or frontend.
4. The service is built from the included `Dockerfile`.

## API Routes

All routes are also available under the `/api` prefix (e.g., `/api/wallets`).

### Wallets (`/wallets`)

| Method | Path | Query / Body | Description |
|---|---|---|---|
| `GET` | `/wallets` | `?userId=<uuid>` | Get all wallets for a user |
| `POST` | `/wallets/link` | body (see below) | Link a new wallet to a user |
| `GET` | `/wallets/:id/balance` | — | Get wallet balance |
| `GET` | `/wallets/:id/transactions` | `?page&limit&type&status` | Get paginated wallet transactions |

#### Link wallet body

```json
{
  "userId": "<uuid>",
  "wallet_type": "pi",
  "wallet_address": "optional-address",
  "currency": "PI"
}
```

`wallet_type` must be one of: `pi`, `crypto`, `fiat`.

#### Transaction query parameters

| Param | Description |
|---|---|
| `page` | Page number (min 1) |
| `limit` | Results per page (1–100) |
| `type` | Filter by type: `deposit`, `withdrawal`, `transfer`, `payment` |
| `status` | Filter by status: `pending`, `completed`, `failed` |

## Testing the Service

### Health check
```bash
curl https://<wallet-service>.up.railway.app/health
```

### Get wallets for a user
```bash
curl "https://<wallet-service>.up.railway.app/wallets?userId=550e8400-e29b-41d4-a716-446655440000"
```

### Link a wallet
```bash
curl -X POST https://<wallet-service>.up.railway.app/wallets/link \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "550e8400-e29b-41d4-a716-446655440000",
    "wallet_type": "pi",
    "currency": "PI"
  }'
```

### Get wallet balance
```bash
curl https://<wallet-service>.up.railway.app/wallets/<wallet-uuid>/balance
```

### Get wallet transactions (paginated)
```bash
curl "https://<wallet-service>.up.railway.app/wallets/<wallet-uuid>/transactions?page=1&limit=20&status=completed"
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

- All query parameters and route parameters are validated with `express-validator`.
- Wallet IDs are validated as UUIDs.
- Transactions endpoint supports filtering by both `type` and `status` simultaneously.


#!/bin/sh
set -e

echo "Resolving any failed migrations..."
npx prisma migrate resolve \
  --rolled-back 20260303000000_add_payment_reconciled_event \
  2>/dev/null || true

echo "Running Prisma migrations..."
npx prisma migrate deploy

echo "Starting Payment Service..."
exec node dist/server.js

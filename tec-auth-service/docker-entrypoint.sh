#!/bin/sh
set -e

echo "Resolving any failed migrations..."
npx prisma migrate resolve \
  --rolled-back 20260302000000_add_pi_auth_fields \
  2>/dev/null || true

echo "Running Prisma migrations..."
npx prisma migrate deploy

echo "Starting Auth Service..."
exec node dist/index.js

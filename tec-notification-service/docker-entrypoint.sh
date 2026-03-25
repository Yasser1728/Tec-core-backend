#!/bin/sh
set -e

echo "Baselining existing database..."
npx prisma migrate resolve --applied "$(ls prisma/migrations | head -1)" 2>/dev/null || true

echo "Running Prisma migrations..."
npx prisma migrate deploy

echo "Starting Notification Service..."
exec node dist/main.js

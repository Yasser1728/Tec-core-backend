#!/bin/sh
set -e

echo "Baselining existing database..."
# لو الـ _prisma_migrations table مش موجودة → نعمل baseline
# لو موجودة بالفعل → الأمر ده هيفشل بهدوء ونكمل
npx prisma migrate resolve --applied "$(ls prisma/migrations | head -1)" 2>/dev/null || true

echo "Running Prisma migrations..."
npx prisma migrate deploy

echo "Starting Wallet Service..."
exec node dist/index.js

#!/bin/sh
set -e

echo "⏳ Waiting for database..."

# Wait for DB (important in Docker / Kubernetes)
until nc -z $DB_HOST $DB_PORT; do
  sleep 1
done

echo "✅ Database is ready"

echo "🔄 Applying Prisma migrations..."
npx prisma migrate deploy

echo "🚀 Starting TEC Auth Service..."

exec node dist/main.js

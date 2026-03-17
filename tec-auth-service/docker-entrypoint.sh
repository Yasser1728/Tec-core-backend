#!/bin/sh
set -e

echo "🚀 [TEC-AUTH] Initializing environment..."

# 1. Self-healing for database schema sync
# This resolves issues if a previous migration was interrupted
echo "🔄 Synchronizing database schema..."
npx prisma migrate resolve --applied 000000000000_init 2>/dev/null || true

# 2. Deploy pending migrations
# Applies your Prisma schema changes to the live database
echo "🐘 Running Prisma migrations..."
npx prisma migrate deploy

# 3. Final safety check for Prisma Client
# Ensures the code can talk to the database correctly
echo "📦 Ensuring Prisma Client is ready..."
npx prisma generate

echo "✅ Environment ready. Launching TEC Auth Service..."

# 4. Start the NestJS application
# Runs the main compiled file in the dist folder
exec node dist/main.js

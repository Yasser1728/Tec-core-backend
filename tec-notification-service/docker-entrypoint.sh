#!/bin/sh
set -e

echo "Running migrations..."

# شغّل الـ SQL مباشرة بدون Prisma migrate
npx prisma db execute --file prisma/migrations/20260325000000_init_notifications/migration.sql --schema prisma/schema.prisma 2>/dev/null || true

# بعدين سجّل الـ migration كـ applied
npx prisma migrate resolve --applied "20260325000000_init_notifications" 2>/dev/null || true

# أي migrations جديدة بعدها
npx prisma migrate deploy 2>/dev/null || true

echo "Starting Notification Service..."
exec node dist/main.js

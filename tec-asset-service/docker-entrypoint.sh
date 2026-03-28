#!/bin/sh
set -e

echo "Running Prisma db push..."
npx prisma db push --schema=./prisma/schema.prisma --accept-data-loss

echo "Starting Asset Service..."
exec node dist/main

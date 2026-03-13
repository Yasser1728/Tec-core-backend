# Multi-stage build for TEC Payment Service

# Stage 1: Build
FROM node:20-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl libssl3 ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy package files and install all dependencies
# --ignore-scripts skips postinstall (prisma generate); the explicit RUN below handles it
# after the source is copied and prisma/schema.prisma is available.
COPY package*.json ./
RUN npm ci --ignore-scripts

# Copy source code
COPY . .

# Generate Prisma client (default output: node_modules/.prisma/client)
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# Stage 2: Production
FROM node:20-slim

WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends openssl libssl3 ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install only production dependencies (prisma is now in dependencies so the CLI
# is available at runtime for `npx prisma migrate deploy` in the entrypoint).
RUN npm ci --only=production --ignore-scripts && npm cache clean --force

# Copy Prisma schema first so `prisma generate` can find it
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY prisma/migrations ./prisma/migrations

# Regenerate Prisma client in the production node_modules to ensure the correct
# binary for this image's architecture/OS is used.
RUN npx prisma generate

# Copy built files from builder
COPY --from=builder /app/dist ./dist
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

ARG PORT=5003
ENV PORT=${PORT}
EXPOSE ${PORT}

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + process.env.PORT + '/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)}).on('error', () => process.exit(1))"

# Run the application
ENTRYPOINT ["./docker-entrypoint.sh"]

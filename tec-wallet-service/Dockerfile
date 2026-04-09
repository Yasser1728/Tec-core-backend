# Multi-stage build for TEC Wallet Service
# Build context: repo root (docker build -f tec-wallet-service/Dockerfile .)

# Stage 1: Build
FROM node:20-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl libssl3 ca-certificates && rm -rf /var/lib/apt/lists/*

# Build shared first
COPY shared/package*.json ./shared/
RUN cd shared && npm install --include=dev --ignore-scripts

COPY shared/ ./shared/
RUN cd shared && npm run build

# Wallet service
COPY tec-wallet-service/package*.json ./tec-wallet-service/
RUN cd tec-wallet-service && npm install --ignore-scripts

COPY tec-wallet-service/ ./tec-wallet-service/

RUN cd tec-wallet-service && npx prisma generate && npm run build

# Stage 2: Production
FROM node:20-slim

WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl libssl3 ca-certificates && rm -rf /var/lib/apt/lists/*

COPY tec-wallet-service/package*.json ./
RUN npm install --only=production --ignore-scripts && npm cache clean --force

COPY --from=builder /app/tec-wallet-service/dist            ./dist
COPY --from=builder /app/tec-wallet-service/prisma/client   ./prisma/client
COPY tec-wallet-service/prisma/schema.prisma                ./prisma/schema.prisma
COPY tec-wallet-service/prisma/migrations                   ./prisma/migrations
COPY tec-wallet-service/docker-entrypoint.sh                ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

ARG PORT=5002
ENV PORT=${PORT}
EXPOSE ${PORT}

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + process.env.PORT + '/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)}).on('error', () => process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]

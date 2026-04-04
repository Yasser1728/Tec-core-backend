# Multi-stage build for TEC Wallet Service

# Stage 1: Build
FROM node:20-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl libssl3 ca-certificates && rm -rf /var/lib/apt/lists/*

# ✅ Copy shared package from root context
COPY shared ./shared
RUN cd shared && npm install && npm run build

COPY tec-wallet-service/package*.json ./
RUN npm install --ignore-scripts

COPY tec-wallet-service/ .

RUN npx prisma generate
RUN npm run build

# Stage 2: Production
FROM node:20-slim

WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends openssl libssl3 ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/shared ./shared

COPY tec-wallet-service/package*.json ./
RUN npm install --only=production --ignore-scripts && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma/client ./prisma/client
COPY tec-wallet-service/prisma/schema.prisma ./prisma/schema.prisma
COPY tec-wallet-service/prisma/migrations ./prisma/migrations
COPY tec-wallet-service/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

ARG PORT=5002
ENV PORT=${PORT}
EXPOSE ${PORT}

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + process.env.PORT + '/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)}).on('error', () => process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]

# Multi-stage build for TEC Payment Service
# Build context: repo root (docker build -f tec-payment-service/Dockerfile .)

# ── Stage 1: Build ────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl libssl3 ca-certificates && rm -rf /var/lib/apt/lists/*

# ── Build shared first ────────────────────────────────────
COPY shared/package*.json ./shared/
RUN cd shared && npm install --ignore-scripts

COPY shared/ ./shared/
RUN cd shared && npm run build

# ── Payment service ───────────────────────────────────────
COPY tec-payment-service/package*.json ./tec-payment-service/
RUN cd tec-payment-service && npm install --ignore-scripts

COPY tec-payment-service/ ./tec-payment-service/

RUN cd tec-payment-service && npx prisma generate && npm run build

# ── Stage 2: Production ───────────────────────────────────
FROM node:20-slim

WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl libssl3 ca-certificates && rm -rf /var/lib/apt/lists/*

# shared dist فقط
COPY --from=builder /app/shared/dist  ./shared/dist
COPY shared/package*.json             ./shared/

# payment service
COPY tec-payment-service/package*.json ./
RUN npm install --only=production --ignore-scripts && npm cache clean --force

COPY tec-payment-service/prisma/schema.prisma    ./prisma/schema.prisma
COPY tec-payment-service/prisma/migrations       ./prisma/migrations
RUN npx prisma generate

COPY --from=builder /app/tec-payment-service/dist ./dist
COPY tec-payment-service/docker-entrypoint.sh     ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

ARG PORT=5003
ENV PORT=${PORT}
EXPOSE ${PORT}

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + process.env.PORT + '/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)}).on('error', () => process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]

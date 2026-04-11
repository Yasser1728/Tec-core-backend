FROM node:20-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl libssl3 ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --ignore-scripts

COPY prisma/ ./prisma/
COPY . .

RUN npx prisma generate --schema=./prisma/schema.prisma
RUN npm run build

FROM node:20-slim AS production

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl libssl3 ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY prisma/ ./prisma/

RUN npm install --ignore-scripts --omit=dev && npm cache clean --force

COPY --from=builder /app/dist                 ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

RUN groupadd -r appgroup && useradd -r -g appgroup appuser
USER appuser

EXPOSE 5004

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 5004) + '/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

CMD ["node", "dist/main"]

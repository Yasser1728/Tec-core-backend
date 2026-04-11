FROM node:20-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl libssl3 ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --ignore-scripts

COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-slim AS production

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl libssl3 ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY prisma/ ./prisma/

RUN npm install --ignore-scripts && npm cache clean --force
RUN npx prisma generate

COPY --from=builder /app/dist ./dist

RUN groupadd -r appgroup && useradd -r -g appgroup appuser
USER appuser

EXPOSE 5011

CMD ["sh", "-c", "npx prisma db push --accept-data-loss && node dist/main.js"]

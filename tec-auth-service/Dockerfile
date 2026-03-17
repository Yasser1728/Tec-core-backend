# ── Stage 1: Builder ────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache openssl

# 1. Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# 2. Copy prisma directory FIRST (This is the missing step!)
# We need the schema before running npm install
COPY prisma ./prisma/

# 3. Install dependencies 
# (Now prisma generate will find the schema in ./prisma/schema.prisma)
RUN npm install

# 4. Copy the rest of the source code
COPY . .

# 5. Build the app
RUN npm run build

# ── Stage 2: Production ─────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache openssl
RUN addgroup -S app && adduser -S app -G app

# Copy necessary files from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY docker-entrypoint.sh ./docker-entrypoint.sh

RUN chmod +x docker-entrypoint.sh && chown -R app:app /app

USER app
ENV PORT=5001
EXPOSE 5001

ENTRYPOINT ["./docker-entrypoint.sh"]

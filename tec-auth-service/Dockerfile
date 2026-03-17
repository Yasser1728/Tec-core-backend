# ─────────────────────────────────────────────────────────────
# Stage 1: Builder
# ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies for Prisma
RUN apk add --no-cache openssl

# Copy only package files first (better caching)
COPY package*.json ./

RUN npm ci

# Copy source
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build NestJS app
RUN npm run build


# ─────────────────────────────────────────────────────────────
# Stage 2: Production
# ─────────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

# Install only required runtime deps
RUN apk add --no-cache openssl

# Create non-root user (Security Best Practice)
RUN addgroup -S app && adduser -S app -G app

# Copy only needed files
COPY package*.json ./

RUN npm ci --omit=dev && npm cache clean --force

# Copy build artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

# Change ownership
RUN chown -R app:app /app

USER app

# App port
ENV PORT=5001
EXPOSE 5001

# Healthcheck (faster + cleaner)
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node dist/healthcheck.js || exit 1

# Start app
CMD ["node", "dist/main.js"]

# ── Stage 1: Builder ────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies for Prisma on Alpine
RUN apk add --no-cache openssl

# Copy package configuration
COPY package*.json ./
COPY tsconfig.json ./

# Use install instead of ci to regenerate the lockfile during the build
# This fixes the "out of sync" errors occurring in Railway
RUN npm install

# Copy source code and prisma schema
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build the NestJS application (outputs to /dist)
RUN npm run build

# ── Stage 2: Production ─────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

# Required for Prisma at runtime
RUN apk add --no-cache openssl

# Security: Create a non-root user
RUN addgroup -S app && adduser -S app -G app

# Copy only the necessary artifacts from the builder stage
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY docker-entrypoint.sh ./docker-entrypoint.sh

# Set permissions
RUN chmod +x docker-entrypoint.sh && chown -R app:app /app

USER app

# Set execution port
ENV PORT=5001
EXPOSE 5001

# Start via the entrypoint script
ENTRYPOINT ["./docker-entrypoint.sh"]

# Multi-stage build for TEC Auth Service

# Stage 1: Build
FROM node:18-alpine AS builder

WORKDIR /app

# Copy Prisma schema
COPY ./prisma ./prisma

# Copy package files
COPY tec-auth-service/package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY tec-auth-service/ .

# Generate Prisma Client
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# Stage 2: Production
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY tec-auth-service/package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy Prisma schema and generated client from builder (avoids npx version mismatch)
COPY ./prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Expose port
EXPOSE 5001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5001/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Run the application
CMD ["node", "dist/index.js"]
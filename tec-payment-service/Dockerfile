# Multi-stage build for TEC Payment Service

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files and install all dependencies
# --ignore-scripts skips postinstall (prisma generate); the explicit RUN below handles it
# after the source is copied and prisma/schema.prisma is available.
COPY package*.json ./
RUN npm ci --ignore-scripts

# Copy source code
COPY . .

# Generate Prisma client (custom output: ./prisma/client)
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# Stage 2: Production
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

# Copy package files
COPY package*.json ./

# Install only production dependencies (--ignore-scripts skips postinstall/prisma generate;
# the generated client is already copied from the builder stage below)
RUN npm ci --only=production --ignore-scripts && npm cache clean --force

# Copy built files from builder
COPY --from=builder /app/dist ./dist
# Copy the generated Prisma client (required at runtime)
COPY --from=builder /app/prisma/client ./prisma/client

ARG PORT=5003
ENV PORT=${PORT}
EXPOSE ${PORT}

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + process.env.PORT + '/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)}).on('error', () => process.exit(1))"

# Run the application
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]

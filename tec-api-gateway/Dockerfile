# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app

# Copy only package files first to optimize caching
COPY package*.json ./

# Install dependencies (npm ci can cause issues, using install)
RUN npm install

# Copy rest of the files and build the project
COPY . .
RUN npm run build

# Stage 2: Production
FROM node:20-alpine
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm install --only=production && npm cache clean --force

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist

# Set port
ARG PORT=5000
ENV PORT=${PORT}
EXPOSE ${PORT}

# Healthcheck for NestJS app
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + process.env.PORT + '/api/assets/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# Run the NestJS main.js
CMD ["node", "dist/main.js"]

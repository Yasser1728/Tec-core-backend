# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Stage 2: Production
FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm install --only=production && npm cache clean --force

COPY --from=builder /app/dist ./dist

ARG PORT=8080
ENV PORT=${PORT}
EXPOSE ${PORT}

# ✅ H4 Fix — healthcheck على /health بتاع الـ Gateway نفسه
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + process.env.PORT + '/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)}).on('error', () => process.exit(1))"

CMD ["node", "dist/main.js"]

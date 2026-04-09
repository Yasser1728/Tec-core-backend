FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache openssl

COPY tec-asset-service/package*.json ./
COPY tec-asset-service/prisma/schema.prisma ./prisma/schema.prisma

RUN npm install

RUN npx prisma generate --schema=./prisma/schema.prisma

COPY tec-asset-service/ .

RUN npm run build && ls -la dist/

EXPOSE 5009

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5009/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)}).on('error', () => process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]

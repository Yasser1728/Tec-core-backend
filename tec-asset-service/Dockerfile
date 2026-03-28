FROM node:22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install
RUN npx prisma generate --schema=./prisma/schema.prisma

COPY . .

RUN npm run build

FROM node:22-alpine AS production

WORKDIR /app

RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install --omit=dev
RUN npx prisma generate --schema=./prisma/schema.prisma

COPY --from=builder /app/dist ./dist

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 5004

ENTRYPOINT ["./docker-entrypoint.sh"]

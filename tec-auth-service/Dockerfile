FROM node:20-alpine AS builder

RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/
RUN npm install

COPY . .
RUN npm run build

FROM node:20-alpine AS production

RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install --omit=dev && npx prisma generate

COPY --from=builder /app/dist ./dist

# ✅ H3 Fix — الـ port الصح 5001
EXPOSE 5001

CMD ["node", "dist/main"]

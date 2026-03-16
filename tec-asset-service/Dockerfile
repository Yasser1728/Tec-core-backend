# ---------- Build Stage ----------
FROM node:22-alpine AS builder

# Install openssl for Prisma
RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install

COPY . .

RUN npx prisma generate --schema=./prisma/schema.prisma
RUN npm run build


# ---------- Production Stage ----------
FROM node:22-alpine

# Install openssl for Prisma in production as well
RUN apk add --no-cache openssl

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package*.json ./

EXPOSE 5004

CMD ["node", "dist/main.js"]

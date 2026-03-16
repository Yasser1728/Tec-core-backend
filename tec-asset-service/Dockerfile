FROM node:22-alpine

WORKDIR /app

# تثبيت مكتبة openssl الضرورية لـ Prisma
RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install

COPY . .

RUN npm run build

# تشغيل الـ Migration ثم السيرفر
CMD ["npm", "run", "start:prod"]

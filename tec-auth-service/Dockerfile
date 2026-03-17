# 1. المرحلة الأولى: بناء التطبيق
FROM node:20-alpine AS builder

WORKDIR /app

# تثبيت مكتبات النظام اللازمة لـ Prisma
RUN apk add --no-cache openssl

# نسخ ملفات التعريف أولاً
COPY package*.json ./
COPY prisma ./prisma/

# تثبيت كل المكتبات (بما فيها Dev dependencies اللازمة للـ build)
RUN npm install

# نسخ الكود بالكامل (مهم جداً قبل الـ build)
COPY . .

# توليد ملفات Prisma Client
RUN npx prisma generate

# تنفيذ عملية البناء (هنا كانت المشكلة)
RUN npm run build

# 2. المرحلة الثانية: التشغيل (تصغير حجم الصورة)
FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache openssl

# نسخ الملفات النهائية فقط من المرحلة الأولى
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000

CMD ["npm", "run", "start"]

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# تثبيت الأدوات اللازمة للـ Prisma
RUN apk add --no-cache openssl

# نسخ ملفات الإعدادات أولاً لضمان الـ Caching
COPY package*.json ./
COPY prisma ./prisma/

# تثبيت كافة المكتبات (بما فيها الـ DevDependencies الضرورية للـ Build)
RUN npm install

# نسخ بقية ملفات المشروع
COPY . .

# توليد Prisma Client
RUN npx prisma generate

# تنفيذ الـ Build للمشروع
RUN npm run build

# Stage 2: Runtime
FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache openssl

# نسخ الملفات المبنية فقط والمكتبات النهائية
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000

# أمر التشغيل
CMD ["npm", "run", "start"]

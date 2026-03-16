# ---------- Build Stage ----------
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Using install instead of ci to avoid issues with missing package-lock.json
RUN npm install

# Copy the rest of the application code
COPY . .

# Generate Prisma Client and build the project
RUN npx prisma generate --schema=./prisma/schema.prisma
RUN npm run build


# ---------- Production Stage ----------
FROM node:22-alpine

WORKDIR /app

# Set environment to production
ENV NODE_ENV=production

# Copy necessary files from builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package*.json ./

# Expose service port
EXPOSE 5004

# Run the application
CMD ["node", "dist/main.js"]

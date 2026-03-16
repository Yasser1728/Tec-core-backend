# ---------- Build Stage ----------
FROM node:22-alpine AS builder

WORKDIR /app

# Copy configuration files first to leverage Docker cache
COPY package*.json ./
COPY prisma ./prisma/

# Use npm install instead of ci to handle missing package-lock.json
RUN npm install

# Copy the rest of the application code
COPY . .

# Generate Prisma Client (using specific schema path) and build the project
RUN npx prisma generate --schema=./prisma/schema.prisma
RUN npm run build


# ---------- Production Stage ----------
FROM node:22-alpine

WORKDIR /app

# Set environment to production
ENV NODE_ENV=production

# Copy only the necessary artifacts from the builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package*.json ./

# Expose the service port
EXPOSE 5004

# Start the application using Node directly for optimal performance
CMD ["node", "dist/main.js"]

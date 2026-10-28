# =====================================================================
# Imagen de producción — build multi-stage
# =====================================================================

FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY prisma ./prisma/
COPY src ./src/
COPY scripts ./scripts/
RUN npx prisma generate

RUN npm run build

# ---------------- Runtime ----------------
FROM node:22-alpine AS runner

WORKDIR /app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json* ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY public ./public

ENV NODE_ENV=production
EXPOSE 3000

USER appuser

# Aplica migraciones si existen y arranca el servidor.
CMD ["sh", "-c", "if [ -d prisma/migrations ]; then npx prisma migrate deploy; fi; node dist/src/index.js"]

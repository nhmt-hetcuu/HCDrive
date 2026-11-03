# ============================================================
# HCDrive - Unified All-in-One Container (Frontend + Backend)
# ============================================================

# Stage 1: Build React Frontend
FROM node:24-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend ./
ENV VITE_API_URL=/api
# Must match RECAPTCHA_SECRET_KEY on the backend: a secret without a site key makes registration always fail.
ARG VITE_RECAPTCHA_SITE_KEY=
ENV VITE_RECAPTCHA_SITE_KEY=$VITE_RECAPTCHA_SITE_KEY
RUN npm run build

# Stage 2: Build Node.js Backend & Prisma Client
FROM node:24-alpine AS backend-builder
WORKDIR /app/backend

COPY backend/package*.json ./
COPY backend/prisma ./prisma
RUN npm ci

COPY backend ./
RUN npm run build && npx prisma generate

# Stage 3: Unified Runner (Single container, Single port)
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV APP_PORT=4000

# Copy backend dependencies, compiled dist, and prisma
COPY --from=backend-builder /app/backend/package*.json ./
COPY --from=backend-builder /app/backend/node_modules ./node_modules
COPY --from=backend-builder /app/backend/dist ./dist
COPY --from=backend-builder /app/backend/prisma ./prisma
# The seed scripts run through tsx at startup and import ../config and ../utils, so the whole src tree is needed.
COPY --from=backend-builder /app/backend/src ./src
COPY --from=backend-builder /app/backend/tsconfig.json ./

# Copy built frontend assets into public_html for Express to serve
COPY --from=frontend-builder /app/frontend/dist ./public_html

EXPOSE 4000

CMD ["sh", "-c", "if [ -f /app/data/9drive.db ] && [ ! -f /app/data/hcdrive.db ]; then cp /app/data/9drive.db /app/data/hcdrive.db; fi && npm run db:migrate:deploy && npm run seed:google-config:docker && npm run seed:user:docker && node dist/server.js"]

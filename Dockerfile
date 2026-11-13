FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/server ./server
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle.config.ts ./

RUN mkdir -p logs backups/system backups/ai-fixes

EXPOSE 5000

ENV NODE_ENV=production

CMD ["node", "dist/index.cjs"]

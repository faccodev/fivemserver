FROM node:20-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat docker-compose
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV production

RUN apk add --no-cache docker-compose bash git python3 mysql-client mariadb-client
RUN git config --system --add safe.directory '*'

# RUN addgroup --system --gid 1001 nodejs
# RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=root:root /app/.next/standalone ./
COPY --from=builder --chown=root:root /app/.next/static ./.next/static

# USER nextjs

EXPOSE 81
ENV PORT 81
ENV HOSTNAME "0.0.0.0"

CMD ["node", "server.js"]

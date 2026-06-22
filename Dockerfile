# ==========================================
# Stage 1: Dependencies (Install Once)
# ==========================================
FROM node:22-alpine AS deps

ENV NEXT_TELEMETRY_DISABLED=1
ENV NPM_CONFIG_AUDIT=false
ENV NPM_CONFIG_FUND=false
ENV NPM_CONFIG_FETCH_RETRIES=5
ENV NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000
ENV NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000
ENV NPM_CONFIG_FETCH_TIMEOUT=600000

WORKDIR /app

# Install runtime compatibility libraries used by Next.js native packages
RUN apk add --no-cache libc6-compat

# Copy metadata first to maximize Docker layer cache reuse
COPY package.json package-lock.json ./
RUN --mount=type=cache,id=quant-web-npm,target=/root/.npm \
  npm ci --prefer-offline

# ==========================================
# Stage 2: Builder (Standalone Output)
# ==========================================
FROM node:22-alpine AS builder

ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

# Keep the build image compatible with native packages such as sharp/swc
RUN apk add --no-cache libc6-compat

# Copy dependencies and source, then build the optimized Next.js bundle
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public && npm run build

# ==========================================
# Stage 3: Runtime (Slim Execution)
# ==========================================
FROM node:22-alpine AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

WORKDIR /app

# Install runtime-only system libs and create an unprivileged user
RUN apk add --no-cache libc6-compat \
  && addgroup -S nodejs \
  && adduser -S nextjs -G nodejs \
  && mkdir -p /app/logs \
  && chown -R nextjs:nodejs /app/logs

# [OPTIMIZATION] Copy only traced standalone output instead of full node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Run as non-root in production
USER nextjs

# Next.js default port
EXPOSE 3000

# Start the standalone Next.js server
CMD ["node", "server.js"]

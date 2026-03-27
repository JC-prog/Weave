# ─── Stage 1: Builder ────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

# sharp requires build tools and vips
RUN apk add --no-cache python3 make g++ vips-dev

WORKDIR /app

# Copy workspace root manifests for pnpm workspaces
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy shared package manifests needed at install time
COPY packages/config/package.json ./packages/config/package.json
COPY packages/logger/package.json ./packages/logger/package.json
COPY packages/types/package.json  ./packages/types/package.json

# Copy media-service manifest
COPY apps/media-service/package.json ./apps/media-service/package.json

# Install pnpm and all dependencies
RUN npm install -g pnpm && pnpm install --frozen-lockfile

# Copy shared package sources
COPY packages/config  ./packages/config
COPY packages/logger  ./packages/logger
COPY packages/types   ./packages/types

# Copy media-service source
COPY apps/media-service ./apps/media-service

# Build shared packages first
RUN pnpm --filter @notebooklm/config build || true
RUN pnpm --filter @notebooklm/logger build || true
RUN pnpm --filter @notebooklm/types  build || true

# Build media-service
RUN pnpm --filter @notebooklm/media-service build

# ─── Stage 2: Runner ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

# vips runtime required by sharp
RUN apk add --no-cache dumb-init vips

WORKDIR /app

ENV NODE_ENV=production

# Copy built artifacts
COPY --from=builder /app/apps/media-service/dist ./dist
COPY --from=builder /app/apps/media-service/package.json ./package.json

# Copy hoisted node_modules
COPY --from=builder /app/node_modules ./node_modules

# Copy shared packages built output
COPY --from=builder /app/packages/config/dist  ./node_modules/@notebooklm/config/dist
COPY --from=builder /app/packages/logger/dist  ./node_modules/@notebooklm/logger/dist
COPY --from=builder /app/packages/types/dist   ./node_modules/@notebooklm/types/dist

COPY --from=builder /app/packages/config/package.json  ./node_modules/@notebooklm/config/package.json
COPY --from=builder /app/packages/logger/package.json  ./node_modules/@notebooklm/logger/package.json
COPY --from=builder /app/packages/types/package.json   ./node_modules/@notebooklm/types/package.json

EXPOSE 3007

# Run as non-root user
USER node

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]

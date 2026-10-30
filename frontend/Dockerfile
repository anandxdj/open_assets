FROM node:20-alpine AS base

WORKDIR /app
# pnpm via corepack (version pinned by the package.json "packageManager" field).
RUN corepack enable
ENV NEXT_TELEMETRY_DISABLED=1


FROM base AS build

# NEXT_PUBLIC_* values are inlined into the bundle at build time, so they must be
# present here. Changing either one means building a new image.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_SITE_URL=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# Keep only what `next start` needs at runtime.
RUN pnpm prune --prod


FROM base AS runtime

ENV NODE_ENV=production \
    PORT=3000

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/next.config.ts ./next.config.ts

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-3000}/robots.txt" || exit 1

# Run next directly (not through pnpm) so SIGTERM reaches it and it stops cleanly.
CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0"]

FROM node:20-alpine

WORKDIR /app

# pnpm via corepack (version pinned by the package.json "packageManager" field).
RUN corepack enable

# All dependencies are installed on purpose: the server runs TypeScript directly
# through tsx, which lives in devDependencies.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY --chown=node:node . .

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

USER node

# /health answers 200 only while MongoDB and Redis both respond, and 503 while the
# process is shutting down.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||4000)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Run node directly (not through pnpm) so SIGTERM reaches the server and it can
# shut down gracefully.
CMD ["node", "--import", "tsx", "index.ts"]

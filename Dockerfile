# syntax=docker/dockerfile:1

# ---- build: install the workspace, build admin (if it has a build) and the server bundle ----
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts/re/package.json ./scripts/re/package.json
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build
# Production dependencies of the server only (workspace packages are bundled into dist).
RUN pnpm --filter @shopme/server --prod deploy /out

# ---- runtime: mirrors the monorepo layout so paths resolve without configuration ----
FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data
WORKDIR /app
COPY --from=build /out/node_modules ./apps/server/node_modules
COPY --from=build /out/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/packages/core/drizzle ./packages/core/drizzle
# Optional pieces: present once the admin SPA / default theme exist.
RUN --mount=from=build,source=/app,target=/src \
    for d in apps/admin/dist packages/theme-default; do \
      if [ -d "/src/$d" ]; then mkdir -p "/app/$d" && cp -r "/src/$d/." "/app/$d/"; fi; \
    done
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Migrations run automatically when the server starts.
CMD ["node", "apps/server/dist/main.js"]

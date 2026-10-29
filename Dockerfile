# syntax=docker/dockerfile:1.7
# Multi-target image build for ENU Town: `--target web | realtime | worker`.

ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV CI=1 NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@12.16.1 && pnpm --version
WORKDIR /repo

FROM base AS deps
COPY . .
RUN pnpm install --frozen-lockfile

FROM deps AS build-web
# Static assets (sprites, map) are committed; regenerate to make sure they match the code.
RUN pnpm --filter @enu/sprites build && pnpm --filter @enu/map check
RUN SKIP_ENV_VALIDATION=1 pnpm --filter @enu/web build

FROM deps AS build-services
RUN pnpm --filter @enu/realtime build && pnpm --filter @enu/worker build
# Production node_modules for the bundled Node services (workspace code is inlined by tsdown).
RUN pnpm --filter @enu/realtime deploy --prod --legacy /out/realtime \
 && pnpm --filter @enu/worker deploy --prod --legacy /out/worker

FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build-web --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build-web --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build-web --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

FROM ${NODE_IMAGE} AS realtime
ENV NODE_ENV=production MAPS_DIR=/app/maps
WORKDIR /app
COPY --from=build-services --chown=node:node /out/realtime ./
COPY --from=build-services --chown=node:node /repo/apps/realtime/dist ./dist
COPY --from=build-services --chown=node:node /repo/apps/web/public/assets/maps ./maps
USER node
EXPOSE 2567
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:'+(process.env.REALTIME_PORT||2567)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.mjs"]

FROM ${NODE_IMAGE} AS worker
ENV NODE_ENV=production MIGRATIONS_DIR=/app/migrations
WORKDIR /app
COPY --from=build-services --chown=node:node /out/worker ./
COPY --from=build-services --chown=node:node /repo/apps/worker/dist ./dist
COPY --from=build-services --chown=node:node /repo/packages/db/migrations ./migrations
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD node dist/healthcheck.mjs
CMD ["node", "dist/index.mjs"]

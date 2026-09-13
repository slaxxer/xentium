# syntax=docker/dockerfile:1
# Production image for the Xentium API. Build context = REPO ROOT.
# Runs the HTTP server by default; override the command to run the worker
# (`node dist/worker.js`). A separate `migrate` stage runs `prisma migrate deploy`.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app
ENV CI=true

# ── Install + build (full workspace; needs all package.json for pnpm) ──────────
FROM base AS build
# A placeholder DB url so `prisma generate` (which reads prisma.config.ts) is happy.
# Generate does not connect; the real URL comes from env at runtime.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm exec prisma generate
RUN pnpm --filter @nodevo/api build
# Flatten just the API's production runtime (workspace + prod deps) into /prod.
# --legacy: pnpm v10 otherwise requires inject-workspace-packages=true to deploy.
RUN pnpm --filter @nodevo/api deploy --prod --legacy /prod

# ── One-shot migration runner (keeps the prisma CLI + schema/migrations) ───────
FROM build AS migrate
WORKDIR /app
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

# ── Lean runtime (server / worker) ─────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /prod/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
EXPOSE 4000
CMD ["node", "dist/server.js"]

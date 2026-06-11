# syntax=docker/dockerfile:1
# Production image for the Nodevo web app: build the Vite SPA, serve via nginx
# (with /api + /uploads reverse-proxied to the api service). Build context = REPO ROOT.

FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
ENV CI=true
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @nodevo/web build

FROM nginx:1.27-alpine AS runner
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80

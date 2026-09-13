#!/usr/bin/env bash
#
#   _   _  ___  ____  _____ _   _  ___
#  | \ | |/ _ \|  _ \| ____| | | |/ _ \
#  |  \| | | | | | | |  _| | | | | | | |
#  | |\  | |_| | |_| | |___| \ V /| |_| |
#  |_| \_|\___/|____/|_____| \_/  \___/
#
#  Xentium — open-source CMS & community platform
#  Copyright (c) 2026 Xentium · https://github.com/slaxxer/nodevo
#  Released under the MIT License — see LICENSE
#
# Launcher:
#   ./xentium.sh        -> bring up Postgres+Redis (wait for healthy), then run api + worker + web
#   ./xentium.sh down   -> stop the infrastructure containers
#
# Ctrl+C stops the three app processes. Infra containers stay up for fast restarts;
# use `./xentium.sh down` when you want to shut them down completely.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE="$ROOT/docker/docker-compose.yml"

if [[ "${1:-}" == "down" ]]; then
  echo "Stopping infrastructure…"
  docker compose -f "$COMPOSE" down
  exit 0
fi

echo "Bringing up Postgres + Redis (waiting for healthchecks)…"
docker compose -f "$COMPOSE" up -d --wait

# The Prisma client is generated, not committed — make sure it exists and is
# current. Works without a .env: generate never connects to a database.
echo "Generating Prisma client…"
pnpm -C "$ROOT" db:generate

echo "Infrastructure healthy. Starting api + worker + web (Ctrl+C to stop)…"
echo

# This launcher IS the developer entry point: opt into development mode unless
# the caller already chose an environment. Deployments that start the API
# directly default to production (config/env.ts).
export NODE_ENV="${NODE_ENV:-development}"

# concurrently runs all three, prefixes/colors their logs, and kills the rest
# if any one exits. exec hands the terminal directly to it for clean signals.
exec pnpm -C "$ROOT" dev:apps

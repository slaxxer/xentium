---
title: Running Xentium in production
description: Two processes, a reverse proxy, and the environment the API won't start without.
sidebar:
  order: 1
---

Most servers should use the installer: see [Installing Xentium on a server](/admin/installing/).
It sets all of this up for you, and the `xentium` command keeps it running and up to date.

This page covers running Xentium **from a git clone**, which is what you want when you
deploy your own build, or when you are working on core and need production behaviour.

## What runs

| Process | Command | What it does |
|---|---|---|
| **API** | `node dist/server.js` (in `apps/api`) | the HTTP API **and** the built web app. One port, no separate static server. |
| **Worker** | `node dist/worker.js` (in `apps/api`) | background jobs: email, scheduled publishing, update checks, clean-ups. |

Both read the same `.env` and run the same build, so always deploy and restart them
**together**. Next to them you need **PostgreSQL 17** and **Redis 7**.

## Build

```bash
git clone https://github.com/slaxxer/xentium.git /srv/xentium
cd /srv/xentium
corepack enable
pnpm install --frozen-lockfile
pnpm db:generate
pnpm turbo run build
```

Apply database migrations with **`prisma migrate deploy`**. Don't use `pnpm db:migrate`
on a server: that's `migrate dev`, which can offer to reset your database.

## systemd

Use one unit per process. The worker's unit is the same apart from `dist/worker.js` and
its name.

```ini
# /etc/systemd/system/xentium-api.service
[Unit]
Description=Xentium API
After=network.target postgresql.service redis-server.service
Wants=postgresql.service redis-server.service

[Service]
Type=simple
User=xentium
WorkingDirectory=/srv/xentium/apps/api
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

## nginx

Send **everything** to the API; it serves the web app itself.

```nginx
server {
    server_name community.example.com;
    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_read_timeout 300s;
        proxy_buffering off;   # keeps the live style updates (SSE) flowing
    }
}
```

Then run `certbot --nginx -d community.example.com` for HTTPS.

:::caution[You need `proxy_buffering off`]
Live style updates (`/api/appearance/stream`) use Server-Sent Events. With buffering on,
nginx holds the events back, and open tabs don't pick up a published style or a theme
switch until they reload.
:::

## First run

Open the site and go through the **install wizard**. It checks the database, creates the
site and the first admin, generates every secret and writes `.env`, then locks itself
when it's done. [Installing from source](/start/install/) explains what it asks for.

## Things that look broken but aren't

:::caution[`/` and `/install` return 404, but `/api/*` answers]
The API started in **setup mode** because a required variable is missing, most often
`DUMMY_ARGON2_HASH`. In setup mode it answers API calls but doesn't serve the web app.
Check the log (`journalctl -u xentium-api`); it names the missing variable.
:::

- **`NODE_ENV` defaults to `production`.** You have to opt in to development mode, so a
  server that forgets to set it is safe rather than chatty.
- **Mail settings live in the ACP** (System → Email), not in `.env`, so you can change them
  without redeploying.

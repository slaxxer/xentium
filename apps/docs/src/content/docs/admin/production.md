---
title: Running Xentium in production
description: Two processes, one reverse proxy, and the environment the API refuses to start without.
sidebar:
  order: 1
---

This page describes a production install **from a clone**, which is how Xentium runs
today. A one-line installer and in-ACP core updates are planned for **Xentium 1.0**; this
page will then describe that path, and the clone will become the developer's route.

## What runs

| Process | Command | Role |
|---|---|---|
| **API** | `node dist/server.js` (in `apps/api`) | HTTP API **and** the built web app. One port, no separate static server. |
| **Worker** | `node dist/worker.js` (in `apps/api`) | BullMQ jobs: email, scheduled publishes, update checks, purges. |

Both read the same `.env` and the same build, so they are always deployed and restarted
**together**. Alongside them you need **PostgreSQL 17** and **Redis 7**.

## Build

```bash
git clone https://github.com/slaxxer/xentium.git /srv/xentium
cd /srv/xentium
corepack enable
pnpm install --frozen-lockfile
pnpm db:generate
pnpm turbo run build
```

Apply database migrations with **`prisma migrate deploy`**, never `pnpm db:migrate`:
that one is `migrate dev`, which can offer to reset the database.

## systemd

One unit per process. The worker's unit is identical apart from `dist/worker.js` and
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

Proxy **everything** to the API; it serves the web app itself.

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
        proxy_buffering off;   # keeps the live-style SSE stream flowing
    }
}
```

Then `certbot --nginx -d community.example.com` for TLS.

:::caution[`proxy_buffering off` is not optional]
The appearance stream (`/api/appearance/stream`) is Server-Sent Events. With buffering
on, nginx holds the events back and open tabs stop picking up a published style or a
theme switch until they reload.
:::

## First run

Open the site and follow the **install wizard**. It checks the database, creates the
site and the first admin, generates every secret and writes `.env`. It removes itself
when it finishes. See [Installing from source](/start/install/) for what it asks.

## Things that look broken and are not

:::caution[`/` and `/install` return 404, but `/api/*` answers]
The API started in **setup mode** because a required variable is missing, most often
`DUMMY_ARGON2_HASH`. In setup mode it answers the API and serves no web app. Check
the log (`journalctl -u xentium-api`) for the variable it names.
:::

- **`NODE_ENV` defaults to `production`.** Development behaviour is an explicit opt-in,
  so a server that forgets to set it is safe rather than chatty.
- **Mail** is configured in the ACP (System → Email), not in `.env`, so an operator can
  change it without a redeploy.

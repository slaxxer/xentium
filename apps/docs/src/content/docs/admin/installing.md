---
title: Installing Xentium on a server
description: One command that checks the server, sets up the database, installs the app and opens the wizard.
sidebar:
  order: 0
---

You install Xentium from npm. There is no clone, no build step and nothing to compile on
the server:

```bash
npm create xentium@latest my-community
```

That takes about a minute. It checks the server, sets up PostgreSQL and Redis, installs the
app, offers to install systemd units, and gives you the address where you finish the install
in your browser.

## Before you start

You need Node 22.12 or newer (24 is what we recommend) and npm 10 or newer. For the database
you need either Docker, which is the default and the least work, or a PostgreSQL 14+ and a
Redis 6+ you already run.

If you want to know whether a server is ready without installing anything:

```bash
npm create xentium@latest -- --check
```

It prints every check with a tick, a warning or a cross, and for anything that fails it
prints the command that fixes it on that system. Nothing is downloaded until every check
passes. Add `--json` if a script is reading the result.

## What the installer asks

**Where it goes.** A directory that does not exist yet, or an empty one.

**The port and the address.** The port the app listens on, and the address people will use.
The address ends up in emails and links, so use the real one if you have it. You can change
it later in the ACP.

**The database.** Docker writes a Compose file inside the site, generates a password and
starts PostgreSQL 17 and Redis 7 for you. Both are published on `127.0.0.1` only, so nothing
outside the machine can reach them, and the data lives in named Docker volumes. If you have
your own, pass `--database-url` and `--redis-url` and the installer tests them instead.

**systemd.** On Linux it offers to install two units, `xentium-api` and `xentium-worker`, so
the site comes back after a reboot. This is the part that asks for sudo, and it tells you
exactly which two files it writes. Say no and you can do it later with
`xentium install-service`.

## What you get

```
my-community/
  xentium.json        version, port, address
  releases/<v>/       one directory per installed release
  current -> releases/<v>
  shared/.env         config and secrets
  shared/uploads/     avatars, attachments, installed plugins
  shared/backups/     the database dump taken before each update
```

`shared/` is yours and updates never touch it. A release is a self-contained directory, and
`current` is a symlink, which is what makes an update a swap and a rollback the same swap the
other way.

Inside the site directory the `xentium` command manages everything:

```bash
npx xentium status     # version, processes, whether it answers
npx xentium doctor     # check the machine and this install
npx xentium backup     # dump the database into shared/backups
npx xentium update     # install the newest release and switch to it
```

Your site tells you in the ACP when there is a new release: see
[Updating Xentium](/admin/updating/).

## Putting it behind nginx

The app serves the API and the web app on one port, so the proxy has one upstream. Turn
buffering off, or live updates in the ACP arrive in bursts:

```nginx
server {
  listen 443 ssl;
  server_name community.example.com;

  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
  }
}
```

Then set the site's address to the https one, in the ACP or in `shared/.env`.

## Installing without a registry

An air-gapped server can install from a tarball. On a machine that has network access:

```bash
npm pack @xentium/server@latest
```

Copy the `.tgz` over, and point the installer at it:

```bash
npm create xentium@latest my-community -- --package ./xentium-server-1.0.0.tgz
```

`xentium update --package <tgz>` updates the same way.

## When something goes wrong

`npx xentium doctor` is the first thing to run. It checks the same things the installer did,
against the install you actually have, and tells you what to do about anything it doesn't
like.

If the site does not answer after a restart and it runs under systemd, the logs are in
`journalctl -u xentium-api -n 50`.

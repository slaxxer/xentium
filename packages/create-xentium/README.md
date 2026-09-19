# create-xentium

Installs [Xentium](https://doc.xentium.org), the open-source community platform.

```bash
npm create xentium@latest my-community
```

It checks your server first, sets up PostgreSQL and Redis, installs the app, and gives you the
address to finish the install in your browser. It takes about a minute.

## What it does

1. **Checks the server.** Node, npm, memory, disk, the port, whether the app's one native
   module has a prebuilt binary for your platform, and whether the database is reachable.
   Anything missing is printed with the command that fixes it *for the system you're on*.
   Nothing is downloaded until the checks pass.
2. **Sets up the database.** Docker by default: it writes a Compose file inside the site,
   generates a password and starts PostgreSQL 17 and Redis 7, both bound to `127.0.0.1` only.
   If you already have them, give it the connection URLs instead.
3. **Installs the app** from npm into `releases/<version>/`, with the exact dependency tree we
   tested and published.
4. **Offers systemd units** so the site comes back after a reboot.
5. **Hands you the URL** for the install wizard, where you name the site and create the admin.

## Options

```
--yes                 take every default; never ask
--check               run the checks and stop (exit code says whether it would work)
--json                machine-readable check output, with --check
--port <n>            the port the app listens on (default 4000)
--url <address>       where people will reach the site
--database-url <url>  use your own PostgreSQL instead of Docker
--redis-url <url>     use your own Redis instead of Docker
--version <spec>      a version or dist-tag of @xentium/server (default latest)
--package <path>      install from a packed tarball (offline installs)
--no-service          don't offer to install systemd units
```

It never installs system packages. When something is missing it tells you the command and
stops — what gets installed on your server is your call.

Afterwards, the `xentium` command manages the site: `npx xentium status`, `npx xentium update`,
`npx xentium backup`.

Docs: https://doc.xentium.org

/**
 * The Docker path: a Compose file inside the site that runs this site's
 * PostgreSQL and Redis, and nothing else.
 *
 * Both are published on 127.0.0.1 only. A database that answers the internet
 * because an install wrote `ports: 5432:5432` is how small sites get taken, and
 * Xentium never needs to reach either of them from another machine.
 *
 * The data lives in named Docker volumes, not in a directory inside the site.
 * A bind mount is written by the container's own user, which leaves root-owned
 * files behind — the admin then cannot delete, move or back up their own site
 * directory without sudo.
 */
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import { portFree, run } from "../../cli/src/checks.js";
import { exec } from "../../cli/src/release.js";
import type { Site } from "../../cli/src/site.js";

export interface DatabaseSetup {
  databaseUrl: string;
  redisUrl: string;
  postgresPort: number;
  redisPort: number;
}

/** The first free port at or after `from` — a machine often already runs a Postgres. */
export async function freePortFrom(from: number, tries = 20): Promise<number> {
  for (let port = from; port < from + tries; port++) {
    if (await portFree(port, "127.0.0.1")) return port;
  }
  throw new Error(`No free port between ${from} and ${from + tries}.`);
}

/** A password with no characters that need escaping in a URL or a shell. */
function password(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function composeFile(setup: DatabaseSetup, projectName: string, pgPassword: string): string {
  return `# PostgreSQL and Redis for the Xentium site next to this file.
# Both listen on 127.0.0.1 only — nothing outside this machine can reach them.
name: ${projectName}

services:
  postgres:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: xentium
      POSTGRES_PASSWORD: ${pgPassword}
      POSTGRES_DB: xentium
    ports: ["127.0.0.1:${setup.postgresPort}:5432"]
    volumes: ["postgres-data:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U xentium"]
      interval: 5s
      timeout: 5s
      retries: 20

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    # noeviction: BullMQ keeps queued jobs in Redis, and any other policy is
    # allowed to throw them away when memory runs out.
    command: ["redis-server", "--maxmemory-policy", "noeviction", "--appendonly", "yes"]
    ports: ["127.0.0.1:${setup.redisPort}:6379"]
    volumes: ["redis-data:/data"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 20

volumes:
  postgres-data:
  redis-data:
`;
}

/** Write the Compose file and bring both containers up, healthy. */
export async function startDatabases(site: Site, projectName: string): Promise<DatabaseSetup> {
  const postgresPort = await freePortFrom(5432);
  const redisPort = await freePortFrom(6379);
  const pgPassword = password();
  const setup: DatabaseSetup = {
    postgresPort,
    redisPort,
    databaseUrl: `postgresql://xentium:${pgPassword}@127.0.0.1:${postgresPort}/xentium?schema=public`,
    redisUrl: `redis://127.0.0.1:${redisPort}`,
  };

  await fs.mkdir(site.sharedDir, { recursive: true });
  await fs.writeFile(site.composeFile, composeFile(setup, projectName, pgPassword), { mode: 0o600 });

  const result = await exec("docker", ["compose", "-f", site.composeFile, "up", "-d", "--wait"], {
    cwd: site.sharedDir,
    quiet: true,
    timeout: 5 * 60_000,
  });
  if (result.code !== 0) {
    throw new Error(`Docker Compose could not start the database:\n${result.output.trim().slice(-1500)}`);
  }
  return setup;
}

/** Is a Compose project for this site already running? */
export async function composeRunning(site: Site): Promise<boolean> {
  const out = await run("docker", ["compose", "-f", site.composeFile, "ps", "--status", "running", "--quiet"]);
  return !!out && out.length > 0;
}

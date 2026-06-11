import { statfs } from "node:fs/promises";
import { promises as fs } from "node:fs";
import Redis from "ioredis";
import { env } from "../../../config/env.js";
import { prisma } from "../../../infrastructure/db.js";
import type { EnvironmentCheckDto } from "@nodevo/contracts";

const MIN_NODE_MAJOR = 20;
const MIN_FREE_BYTES = 500 * 1024 * 1024;

function redact(raw: string): string {
  try {
    const u = new URL(raw);
    const auth = u.username ? `${u.username}:••••@` : "";
    return `${u.protocol}//${auth}${u.host}${u.pathname}`;
  } catch {
    return "unparseable URL";
  }
}

async function checkNode() {
  const major = Number(process.versions.node.split(".")[0]);
  return {
    key: "node",
    name: "Node.js",
    ok: major >= MIN_NODE_MAJOR,
    detail: `Detected: v${process.versions.node} · Required: ${MIN_NODE_MAJOR}+`,
  };
}

async function checkPostgres() {
  try {
    const rows = await prisma.$queryRaw<Array<{ version: string }>>`SELECT version()`;
    const ver = rows[0]?.version.match(/PostgreSQL (\d+\.\d+)/)?.[1] ?? "unknown";
    return {
      key: "postgres",
      name: "PostgreSQL",
      ok: ver === "unknown" || parseFloat(ver) >= 14,
      detail: `Detected: ${ver} · Required: 14+`,
    };
  } catch {
    return { key: "postgres", name: "PostgreSQL", ok: false, detail: "Could not connect" };
  }
}

async function checkRedis() {
  const client = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
  });
  try {
    await client.connect();
    const ver = (await client.info("server")).match(/redis_version:(\S+)/)?.[1] ?? "unknown";
    return { key: "redis", name: "Redis", ok: true, detail: `Detected: ${ver} · Required: 6.0+` };
  } catch {
    return { key: "redis", name: "Redis", ok: false, detail: "Could not connect" };
  } finally {
    client.disconnect();
  }
}

async function checkStorage() {
  try {
    const s = await statfs(env.DATA_DIR);
    const free = s.bavail * s.bsize;
    return {
      key: "storage",
      name: "Storage",
      ok: free >= MIN_FREE_BYTES,
      detail: `Detected: ${(free / 1024 ** 3).toFixed(1)} GB free · Required: 500 MB`,
    };
  } catch {
    return { key: "storage", name: "Storage", ok: false, detail: "Could not read disk" };
  }
}

async function checkDatabaseUrl() {
  const present = !!env.DATABASE_URL;
  return {
    key: "database_url",
    name: "Database URL",
    ok: present,
    detail: present ? redact(env.DATABASE_URL) : "DATABASE_URL not set",
  };
}

async function checkDataDir() {
  try {
    await fs.mkdir(env.DATA_DIR, { recursive: true });
    const probe = `${env.DATA_DIR}/.write-probe`;
    await fs.writeFile(probe, "ok");
    await fs.rm(probe);
    return {
      key: "data_dir",
      name: "Installation directory",
      ok: true,
      detail: `Detected: ${env.DATA_DIR}`,
    };
  } catch {
    return {
      key: "data_dir",
      name: "Installation directory",
      ok: false,
      detail: `${env.DATA_DIR} (not writable)`,
    };
  }
}

export async function environmentCheck(): Promise<EnvironmentCheckDto> {
  const checks = await Promise.all([
    checkNode(),
    checkPostgres(),
    checkRedis(),
    checkStorage(),
    checkDatabaseUrl(),
    checkDataDir(),
  ]);
  return { ok: checks.every((c) => c.ok), checks };
}

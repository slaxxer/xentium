import { Worker } from "bullmq";
import { bullConnection, bullPrefix } from "../infrastructure/queue.js";
import { prisma } from "../infrastructure/db.js";
import { env } from "../config/env.js";
import { bustSettingsCache } from "../shared/utils/settings.js";
import { logger } from "../infrastructure/logging/logger.js";

/**
 * §16 daily update check-in: report the installed plugin inventory to the
 * marketplace and cache what came back (newer versions, critical flags,
 * renewalRequired). The ACP reads the cache — this is how customers see
 * renewal warnings and critical updates BEFORE something stops working.
 * The same call feeds the marketplace's per-site inventory view.
 */
const UPDATES_SETTING = "marketplace.updates";

export async function processUpdateCheck(): Promise<void> {
  // Dev licensing signs locally — there is no server to ask.
  if (env.LICENSE_DEV_PRIVATE_KEY) return;

  const tokenRow = await prisma.setting.findUnique({ where: { key: "marketplace.nodevo.io.token" } });
  const token = (tokenRow?.value as string | null) ?? null;
  if (!token) return; // no connected account — nothing to check against

  const plugins = await prisma.installedPlugin.findMany({
    select: { id: true, installedVersion: true },
  });

  const res = await fetch(`${env.LICENSE_SERVER_URL}/marketplace/updates`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      installed: plugins.map((p) => ({ pluginId: p.id, version: p.installedVersion })),
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);

  if (!res?.ok) {
    logger.warn({ status: res?.status ?? "unreachable" }, "Marketplace update check failed — keeping last cache");
    return;
  }

  const body = await res.json() as { updates: unknown[] };
  const value = JSON.stringify({ checkedAt: new Date().toISOString(), updates: body.updates ?? [] });
  await prisma.setting.upsert({
    where:  { key: UPDATES_SETTING },
    update: { value },
    create: { key: UPDATES_SETTING, value },
  });
  bustSettingsCache(UPDATES_SETTING);

  logger.info({ installed: plugins.length, updates: (body.updates ?? []).length }, "Marketplace update check completed");
}

export function startUpdateCheckWorker() {
  return new Worker(
    "update-check",
    async () => {
      await processUpdateCheck();
    },
    { connection: bullConnection, prefix: bullPrefix },
  );
}

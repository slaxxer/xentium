import { SYSTEM_REQUIREMENTS, checkVersion, displayVersion, nodeSecurityUpdate } from "@xentium/contracts";

/**
 * Environment rows built from SYSTEM_REQUIREMENTS, shared by the wizard's full
 * check and the setup-mode server.
 *
 * ⚠ Setup mode runs before `.env` exists, so this file may import nothing that
 * validates config or connects on load: `@xentium/contracts` only.
 */

export interface RequirementRow {
  key: string;
  name: string;
  ok: boolean;
  detail: string;
  warn?: boolean;
}

/** Turn a version check into a row: fail blocks, warn passes with a note. */
function versionRow(
  key: string,
  name: string,
  detected: string,
  req: { minimum: string; recommended?: string },
): RequirementRow {
  const result = checkVersion(detected, req);
  const wanted = req.recommended
    ? `Required: ${displayVersion(req.minimum)}+ · Recommended: ${displayVersion(req.recommended)}+`
    : `Required: ${displayVersion(req.minimum)}+`;
  return {
    key,
    name,
    ok: result !== "fail",
    ...(result === "warn" ? { warn: true } : {}),
    detail: `Detected: ${detected} · ${wanted}`,
  };
}

export function nodeRow(version = process.versions.node): RequirementRow {
  const row = versionRow("node", "Node.js", version, SYSTEM_REQUIREMENTS.node);
  const update = row.ok ? nodeSecurityUpdate(version) : null;
  // Runs, but misses Node's own security fixes: say so, and name the version.
  return update
    ? { ...row, warn: true, detail: `${row.detail} · Missing security fixes: update to ${update} or newer` }
    : row;
}

export function postgresRow(version: string): RequirementRow {
  return versionRow("postgres", "PostgreSQL", version, SYSTEM_REQUIREMENTS.postgres);
}

/**
 * Redis: the version, and the eviction policy. BullMQ can lose queued jobs under
 * any policy but `noeviction`, and nothing else would ever tell the admin.
 */
export function redisRow(version: string, maxmemoryPolicy: string | null): RequirementRow {
  const row = versionRow("redis", "Redis", version, SYSTEM_REQUIREMENTS.redis);
  const wanted = SYSTEM_REQUIREMENTS.redisMaxmemoryPolicy;
  if (row.ok && maxmemoryPolicy && maxmemoryPolicy !== wanted) {
    return {
      ...row,
      warn: true,
      detail: `${row.detail} · maxmemory-policy is "${maxmemoryPolicy}"; set it to "${wanted}" or queued jobs can be lost when Redis fills up`,
    };
  }
  return row;
}

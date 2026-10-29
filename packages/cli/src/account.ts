import { promises as fs } from "node:fs";
import path from "node:path";
import { run } from "./checks.js";
import { exec, pgConnection } from "./release.js";
import type { Site } from "./site.js";

/**
 * Take two-factor sign-in off one account, from the server.
 *
 * The last way back in for someone who lost their phone AND their recovery codes
 * when no other admin can reset it in the ACP — typically a site's only admin.
 * Whoever can run this already holds the server, so it asks nothing more. The
 * account's sessions end too; the person signs in again with their password.
 *
 * Through psql, like the deploy record, with the name as a psql variable so it is
 * quoted by psql and cannot break out of the statement.
 */
export async function resetTwoFactor(site: Site, who: string): Promise<{ ok: true; usernames: string[] } | { ok: false; reason: string }> {
  const raw = site.readEnv().DATABASE_URL;
  if (!raw) return { ok: false, reason: "DATABASE_URL is not set in shared/.env" };
  if (!(await run("psql", ["--version"]))) return { ok: false, reason: "psql is not installed" };
  const { url } = pgConnection(raw);

  const sql = `WITH target AS (
  UPDATE xcf_users
     SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL, totp_recovery_hashes = '{}'
   WHERE lower(email) = lower(:'who') OR lower(username) = lower(:'who')
  RETURNING id, username
), ended AS (
  UPDATE xcf_sessions SET "revokedAt" = now()
   WHERE "userId" IN (SELECT id FROM target) AND "revokedAt" IS NULL
)
SELECT username FROM target;
`;
  await fs.mkdir(site.backupsDir, { recursive: true });
  const file = path.join(site.backupsDir, `.reset-2fa-${process.pid}.sql`);
  await fs.writeFile(file, sql, { mode: 0o600 });
  try {
    const result = await exec("psql", [
      "--quiet", "--no-psqlrc", "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1",
      "--set", `who=${who}`, "--file", file, url,
    ], { quiet: true, timeout: 30_000 });
    if (result.code !== 0) return { ok: false, reason: result.output.trim() || "psql failed" };
    return { ok: true, usernames: result.output.split("\n").map((l) => l.trim()).filter(Boolean) };
  } finally {
    await fs.rm(file, { force: true });
  }
}

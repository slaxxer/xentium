#!/usr/bin/env node
/**
 * Announce a published release to installed sites, with no prompts.
 *
 *   XENTIUM_OPS_EMAIL=… XENTIUM_OPS_PASSWORD=… \
 *     node scripts/announce-release.mjs 1.0.0-alpha.13 [normal|security|critical]
 *
 * The same marketplace record `./release.sh --announce-only` registers, for when
 * nobody is at a terminal: the Announce workflow runs it from the Actions tab.
 * The CHANGELOG is the release notes. It refuses a version npm does not have,
 * because an announcement nobody can install is worse than none.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MARKETPLACE = (process.env.XENTIUM_MARKETPLACE_URL ?? "https://plugins.xentium.org").replace(/\/+$/, "");
const [version, severity = "normal"] = process.argv.slice(2);

const die = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) die("Usage: announce-release.mjs <version> [normal|security|critical]");
if (!["normal", "security", "critical"].includes(severity)) die(`Unknown severity "${severity}".`);

const { XENTIUM_OPS_EMAIL: email, XENTIUM_OPS_PASSWORD: password } = process.env;
if (!email || !password) die("Set XENTIUM_OPS_EMAIL and XENTIUM_OPS_PASSWORD (a marketplace staff account).");

let onNpm = "";
try { onNpm = execFileSync("npm", ["view", `@xentium/server@${version}`, "version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* not there */ }
if (onNpm !== version) die(`npm has no @xentium/server@${version}. Publish it first.`);

async function api(path, { method = "GET", token, body } = {}) {
  const res = await fetch(`${MARKETPLACE}${path}`, {
    method,
    headers: {
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* not json */ }
  if (!res.ok) throw new Error(`${res.status} ${parsed?.error?.message ?? parsed?.message ?? ""}`.trim());
  return parsed;
}

const notes = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8").replace(/^#\s+Changelog\s*/i, "").trim();

let token;
try {
  ({ accessToken: token } = await api("/api/portal/auth/login", { method: "POST", body: { email, password } }));
  await api("/api/ops/overview", { token });
} catch (err) {
  die(`Sign-in failed or the account is not staff: ${err.message}`);
}

let record;
try {
  record = await api("/api/ops/core-releases", {
    method: "POST", token,
    body: { version, channel: "stable", severity, minUpgradeFrom: null, notes: notes || null, upgradeNotes: null, state: "published" },
  });
} catch (err) {
  die(`The marketplace refused the release: ${err.message}`);
}
console.log(`✓ core release ${record.version} is ${record.state} on ${MARKETPLACE}`);

// Read it back the way a site one release behind will see it.
const previous = execFileSync("git", ["tag", "--sort=-v:refname"], { cwd: ROOT, encoding: "utf8" })
  .split("\n").map((t) => t.trim().replace(/^v/, "")).find((t) => t && t !== version);
if (previous) {
  const seen = await api(`/api/v1/core/latest?channel=stable&from=${encodeURIComponent(previous)}`);
  console.log(`  a site on ${previous} is told: updateAvailable=${seen.updateAvailable}, latest=${seen.latest?.version}`);
  if (!seen.updateAvailable) die("The marketplace does not offer this as an update. Check the record.");
}

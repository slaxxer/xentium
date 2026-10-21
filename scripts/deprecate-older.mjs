#!/usr/bin/env node
/**
 * Mark every version older than this release as deprecated, on all ten packages.
 *
 *   node scripts/deprecate-older.mjs 1.0.0-alpha.17
 *   node scripts/deprecate-older.mjs 1.0.0-alpha.17 --security-below=1.0.0-alpha.16
 *   node scripts/deprecate-older.mjs 1.0.0-alpha.17 --dry-run   # list, change nothing
 *
 * npm then warns anyone who installs an old one and points them at this release.
 * Versions below `--security-below` also say they miss security fixes. It refuses
 * before deprecating anything if a package is missing the version, and never
 * touches this version or a newer one. Run by the "npm" workflow (NPM_TOKEN) or by
 * hand on your own login.
 */
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const version = args.find((a) => !a.startsWith("--"));
const dryRun = args.includes("--dry-run");
const securityBelow = args.find((a) => a.startsWith("--security-below="))?.split("=")[1] ?? null;
if (!version) {
  console.error("usage: node scripts/deprecate-older.mjs <version> [--security-below=<version>]");
  process.exit(1);
}

const PACKAGES = [
  "@xentium/contracts", "@xentium/errors", "@xentium/server-kit", "@xentium/auth",
  "@xentium/plugin-engine", "@xentium/plugin-kit", "@xentium/plugin-sdk",
  "@xentium/server", "xentium", "create-xentium",
];

const npm = (cmdArgs, opts = {}) => execFileSync("npm", cmdArgs, { encoding: "utf8", ...opts });

/** Prerelease-aware order: 1.0.0-alpha.9 < 1.0.0-alpha.10 < 1.0.0. */
function compare(a, b) {
  const parse = (v) => {
    const [core, pre] = v.split("-", 2);
    return { nums: core.split(".").map(Number), pre: pre ? pre.split(".") : null };
  };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] - y.nums[i];
  if (!x.pre || !y.pre) return x.pre ? -1 : y.pre ? 1 : 0;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const np = /^\d+$/.test(p), nq = /^\d+$/.test(q);
    if (np && nq && Number(p) !== Number(q)) return Number(p) - Number(q);
    if (np !== nq) return np ? -1 : 1;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

const versionsOf = (name) => {
  try { return [].concat(JSON.parse(npm(["view", name, "versions", "--json"], { stdio: ["ignore", "pipe", "ignore"] }))); }
  catch { return []; }
};

const all = Object.fromEntries(PACKAGES.map((name) => [name, versionsOf(name)]));
const missing = PACKAGES.filter((name) => !all[name].includes(version));
if (missing.length) {
  console.error(`✗ ${version} is not on the registry for: ${missing.join(", ")}`);
  console.error("  nothing was deprecated.");
  process.exit(1);
}

let count = 0;
for (const name of PACKAGES) {
  for (const old of all[name].filter((v) => compare(v, version) < 0)) {
    const insecure = securityBelow && compare(old, securityBelow) < 0;
    const message = insecure
      ? `Outdated, and it misses security fixes. Please use ${version} or newer.`
      : `Outdated. Please use ${version} or newer.`;
    if (dryRun) console.log(`${name}@${old}: ${message}`);
    else npm(["deprecate", `${name}@${old}`, message], { stdio: "inherit" });
    count++;
  }
}
console.log(`\n${dryRun ? "would deprecate" : "deprecated"} ${count} older versions across ${PACKAGES.length} packages (newest kept: ${version})`);

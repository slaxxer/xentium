#!/usr/bin/env node
/**
 * Point `latest` at this release on all ten packages.
 *
 *   node scripts/promote-latest.mjs              # the version in package.json
 *   node scripts/promote-latest.mjs 1.0.0-alpha.12
 *
 * Run after the release workflow has published: from the Actions tab (the "npm"
 * workflow, with the NPM_TOKEN secret), or by hand on your own login, where npm may
 * ask for a passkey confirmation in the browser. The release workflow itself can't:
 * Trusted Publishing only covers `npm publish`, not dist-tags.
 *
 * It refuses before moving anything if a package is missing the version, so
 * `latest` never points at a release some packages do not have.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2] ?? JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

const PACKAGES = [
  "@xentium/contracts", "@xentium/errors", "@xentium/server-kit", "@xentium/auth",
  "@xentium/plugin-engine", "@xentium/plugin-kit", "@xentium/plugin-sdk",
  "@xentium/server", "xentium", "create-xentium",
];

const npm = (args, opts = {}) => execFileSync("npm", args, { encoding: "utf8", ...opts });

const missing = PACKAGES.filter((name) => {
  try {
    return ![].concat(JSON.parse(npm(["view", name, "versions", "--json"], { stdio: ["ignore", "pipe", "ignore"] }))).includes(version);
  } catch {
    return true;
  }
});
if (missing.length) {
  console.error(`✗ ${version} is not on the registry for: ${missing.join(", ")}`);
  console.error("  latest was not moved on any package.");
  process.exit(1);
}

for (const name of PACKAGES) npm(["dist-tag", "add", `${name}@${version}`, "latest"], { stdio: "inherit" });
console.log(`\nlatest → ${version} on ${PACKAGES.length} packages`);

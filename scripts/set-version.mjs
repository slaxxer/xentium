#!/usr/bin/env node
/**
 * Lockstep version bump: writes the given SemVer to every workspace
 * package.json (root, apps, packages, e2e). The platform has ONE version —
 * plugins version themselves independently and target it via
 * minXentiumVersion in their manifest.
 *
 *   node scripts/set-version.mjs 1.0.0-alpha.1
 *
 * Policy: prerelease identifiers mark CUTS, not commits. Bump + `git tag
 * v<version>` only when a build is actually handed to testers; move the
 * CHANGELOG's [Unreleased] section under the new version at the same time.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const version = process.argv[2];
if (!version || !SEMVER.test(version)) {
  console.error("Usage: node scripts/set-version.mjs <valid semver, e.g. 1.0.0-alpha.1>");
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/**
 * Every workspace manifest, DISCOVERED rather than listed.
 *
 * This was a hardcoded array, and it went stale the moment packages were added:
 * a bump silently skipped five of them, leaving half the workspace on the old
 * version. Lockstep versioning that quietly is not lockstep is worse than none,
 * because nothing fails — the packages just disagree.
 *
 * Plugins are excluded on purpose: they version themselves and target the
 * platform through `minXentiumVersion` in their manifest.
 */
const manifests = [
  "package.json",
  "e2e/package.json",
  ...["apps", "packages"].flatMap((dir) =>
    readdirSync(resolve(root, dir), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => `${dir}/${e.name}/package.json`)
      .filter((rel) => existsSync(resolve(root, rel))),
  ),
];

for (const rel of manifests) {
  const file = resolve(root, rel);
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  const old = pkg.version;
  pkg.version = version;
  writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`${rel}: ${old} -> ${version}`);
}

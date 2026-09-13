#!/usr/bin/env node
/**
 * Validate every first-party plugin manifest against the REAL core validator.
 *
 * A manifest field rename (minNodevoVersion -> minXentiumVersion) is invisible
 * to typecheck, lint, tests and even packaging: the field is only read when the
 * engine installs a plugin. That is a bad place to find out.
 */
//
// Run it through tsx, which is how the workspace resolves package sources:
//   pnpm --filter @xentium/api exec tsx ../../scripts/check-plugin-manifests.mjs
//
import fs from "node:fs";
import path from "node:path";
import { validateManifest } from "../packages/plugin-engine/src/index.js";

// The host version the plugins are checked against — the API package's own.

const ROOT = new URL("../", import.meta.url).pathname;
const HOST_VERSION = JSON.parse(
  fs.readFileSync(path.join(ROOT, "apps/api/package.json"), "utf8"),
).version as string;

let failed = 0;
for (const dir of fs.readdirSync(path.join(ROOT, "plugins/official"))) {
  const file = path.join(ROOT, "plugins/official", dir, "manifest.json");
  if (!fs.existsSync(file)) continue;
  try {
    const m = validateManifest(JSON.parse(fs.readFileSync(file, "utf8")), HOST_VERSION);
    console.log(`OK   ${m.id}@${m.version} — requires Xentium ${m.minXentiumVersion}+ (host ${HOST_VERSION})`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${dir}: ${err.message}`);
  }
}
process.exit(failed ? 1 : 0);

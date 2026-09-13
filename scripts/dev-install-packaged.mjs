#!/usr/bin/env node
/**
 * Put the archives in plugins/packaged/ into THIS install's plugin store, for
 * development.
 *
 * The normal path is the marketplace or the ACP upload page, and both refuse
 * what this does on purpose: `updatePlugin` is forward-only, so an install
 * running 1.4.3 can never be moved to a freshly reset 1.0.0. That refusal is
 * right for a real site and wrong for a dev box that is following the rename.
 *
 * It mirrors `installPlugin`: the archive is written to the store as
 * `<id>-<version>.xtplugin`, extracted over `<store>/<id>`, and the row's
 * version, manifest and package path are updated. It does NOT run migrations —
 * a version reset applies no new DDL, and the ledger skips by NAME — and it
 * never changes a plugin's enabled/disabled status.
 *
 * ⚠ Run this AFTER scripts/rename-plugin-ids.mjs. Archives are matched to rows
 * by the manifest id, and plugins/packaged/ still holds every historical
 * artifact — run it first and it matches the PRE-rename archives instead.
 *
 * Dry-run by default:
 *   node --env-file=.env scripts/dev-install-packaged.mjs
 *   node --env-file=.env scripts/dev-install-packaged.mjs --apply
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(new URL("../apps/api/package.json", import.meta.url));
const pg = require("pg");
const AdmZip = require("adm-zip");

const APPLY = process.argv.includes("--apply");
const ROOT = new URL("../", import.meta.url).pathname;
const API_DIR = path.join(ROOT, "apps/api");
const PACKAGED = path.join(ROOT, "plugins/packaged");
const STORE = path.join(path.resolve(API_DIR, process.env.UPLOAD_DIR ?? "./var/uploads"), "plugins");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

// Newest archive per plugin id, by mtime — the store should follow what was
// built last, not whatever sorts highest.
const archives = new Map();
for (const name of await fs.readdir(PACKAGED)) {
  if (!name.endsWith(".xtplugin")) continue;
  const full = path.join(PACKAGED, name);
  const zip = new AdmZip(full);
  const entry = zip.getEntry("manifest.json");
  if (!entry) continue;
  const manifest = JSON.parse(entry.getData().toString("utf8"));
  const { mtimeMs } = await fs.stat(full);
  const seen = archives.get(manifest.id);
  if (!seen || mtimeMs > seen.mtimeMs) archives.set(manifest.id, { full, manifest, zip, mtimeMs });
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  for (const [id, { full, manifest, zip }] of archives) {
    const { rows: [row] } = await client.query(
      `SELECT id, installed_version, status FROM xcf_installed_plugins WHERE id = $1`, [id],
    );
    if (!row) {
      console.log(`  skip  ${id} — not installed here (install it the normal way first)`);
      continue;
    }
    const pkgPath = path.join(STORE, `${id}-${manifest.version}.xtplugin`);
    const extractDir = path.join(STORE, id);
    console.log(`  ${id}  ${row.installed_version} -> ${manifest.version}  (${row.status}, unchanged)`);
    console.log(`        ${path.basename(full)} -> ${pkgPath}`);
    console.log(`        extract -> ${extractDir}`);

    if (!APPLY) continue;

    await fs.mkdir(STORE, { recursive: true });
    await fs.writeFile(pkgPath, await fs.readFile(full));
    await fs.rm(extractDir, { recursive: true, force: true });
    await fs.mkdir(extractDir, { recursive: true });
    zip.extractAllTo(extractDir, true);
    await client.query(
      `UPDATE xcf_installed_plugins
          SET installed_version = $2, manifest = $3::jsonb, package_path = $4, name = $5, vendor = $6
        WHERE id = $1`,
      [id, manifest.version, JSON.stringify(manifest), pkgPath, manifest.name, manifest.vendor],
    );
  }
} finally {
  await client.end();
}

console.log(APPLY ? "\nApplied. Restart the API so the new bundles are loaded." : "\nDry run. Re-run with --apply to write.");

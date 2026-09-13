#!/usr/bin/env node
/**
 * Rename the official plugin ids on an EXISTING install: nodevo-* -> xentium-*.
 *
 * A plugin id is not just a name. It is the primary key of the installed-plugin
 * row, the prefix of every applied-migration id, the owner recorded on a menu
 * item, a value inside layout documents, and the name of the package file and
 * the directory it was extracted to. Renaming the source without renaming these
 * makes core see a plugin it has never installed: it would re-run every
 * migration (against tables that already exist) and lose the enable state.
 *
 * Idempotent, transactional, and DRY-RUN by default — pass --apply to write.
 * Run it with the API stopped, AFTER deploying the renamed core and applying
 * its migrations: it addresses the `xcf_` tables, and the prefix only becomes
 * xcf_ when 20260913140000_rename_ncf_to_xcf runs.
 *
 *   node --env-file=.env scripts/rename-plugin-ids.mjs            # report only
 *   node --env-file=.env scripts/rename-plugin-ids.mjs --apply
 *
 * UPLOAD_DIR is read from the same env; its default (./var/uploads) resolves
 * against the working directory, so run this from the repo root with the same
 * UPLOAD_DIR the API uses.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

// pnpm's store is not flat: `pg` lives in apps/api/node_modules, and ESM
// resolves from the SCRIPT's location, not the working directory. Anchor the
// resolution there rather than adding a dependency to the repo root.
const require = createRequire(new URL("../apps/api/package.json", import.meta.url));
const pg = require("pg");

const RENAMES = {
  "nodevo-forum":               "xentium-forum",
  "nodevo-messaging":           "xentium-messaging",
  "nodevo-shoutbox":            "xentium-shoutbox",
  "nodevo-advanced-moderation": "xentium-advanced-moderation",
  "nodevo-launch":              "xentium-launch",
};

const APPLY = process.argv.includes("--apply");
// UPLOAD_DIR is relative to the API's working directory, not the repo root —
// systemd runs the server from apps/api and dev does the same. Resolve it the
// way the app does, so this script points at the store the API actually uses.
const API_DIR = new URL("../apps/api/", import.meta.url).pathname;
const UPLOAD_DIR = path.resolve(API_DIR, process.env.UPLOAD_DIR ?? "./var/uploads");
const STORE = path.join(UPLOAD_DIR, "plugins");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Run this from the repo root with the app's env loaded.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const plan = [];
/** Files are moved only AFTER the transaction commits: a rollback must not
 *  leave a renamed archive behind a row that still says the old name. */
const fileMoves = [];
const note = (what, count) => { if (count > 0) plan.push(`${count.toString().padStart(4)}  ${what}`); };

try {
  await client.query("BEGIN");

  for (const [oldId, newId] of Object.entries(RENAMES)) {
    // Nothing to do for a plugin this install never had.
    const { rows: [installed] } = await client.query(
      `SELECT id, installed_version, package_path FROM xcf_installed_plugins WHERE id = $1`, [oldId],
    );

    if (installed) {
      const newPath = installed.package_path?.replace(`${oldId}-`, `${newId}-`) ?? null;
      const r = await client.query(
        `UPDATE xcf_installed_plugins SET id = $2, package_path = $3 WHERE id = $1`,
        [oldId, newId, newPath],
      );
      note(`xcf_installed_plugins  ${oldId} -> ${newId}`, r.rowCount);
    }

    // The applied-migration ledger. `id` is "{pluginId}_{ver}_{name}", so the
    // prefix has to move with plugin_id or the runner re-applies everything.
    const m = await client.query(
      `UPDATE xcf_plugin_migrations
          SET plugin_id = $2,
              id        = $2 || substring(id from length($1) + 1)
        WHERE plugin_id = $1`,
      [oldId, newId],
    );
    note(`xcf_plugin_migrations  ${oldId} -> ${newId}`, m.rowCount);

    const menu = await client.query(
      `UPDATE xcf_nav_items SET plugin_id = $2 WHERE plugin_id = $1`, [oldId, newId],
    );
    note(`xcf_nav_items.plugin_id  ${oldId} -> ${newId}`, menu.rowCount);

    // Layout documents name the owning plugin inside the JSON (slot blocks and
    // pluginSlot props). Replace the QUOTED id so a substring never matches.
    const lay = await client.query(
      `UPDATE xcf_layouts
          SET document = replace(document::text, $1, $2)::jsonb
        WHERE document::text LIKE '%' || $3 || '%'`,
      [`"${oldId}"`, `"${newId}"`, oldId],
    );
    note(`xcf_layouts documents mentioning ${oldId}`, lay.rowCount);

    // Settings: the paid-id cache and anything a plugin keyed by its own id.
    const setVal = await client.query(
      `UPDATE xcf_settings
          SET value = replace(value::text, $1, $2)::jsonb
        WHERE value::text LIKE '%' || $3 || '%'`,
      [`"${oldId}"`, `"${newId}"`, oldId],
    );
    note(`xcf_settings values mentioning ${oldId}`, setVal.rowCount);

    const setKey = await client.query(
      `UPDATE xcf_settings SET key = $2 || substring(key from length($1) + 1)
        WHERE key LIKE $1 || '.%'
          AND NOT EXISTS (
            SELECT 1 FROM xcf_settings s2
             WHERE s2.key = $2 || substring(xcf_settings.key from length($1) + 1))`,
      [oldId, newId],
    );
    note(`xcf_settings keys prefixed ${oldId}.`, setKey.rowCount);

    // On disk: the package archive and the extracted directory.
    // EVERY archive, not just the installed version: the store keeps the older
    // ones, and an update rolling forward from a stale name would not find them.
    const archives = await fs.readdir(STORE).catch(() => []);
    const candidates = [
      ...archives.filter((f) => f.startsWith(`${oldId}-`) && f.endsWith(".nvplugin"))
                 .map((f) => [path.join(STORE, f), path.join(STORE, `${newId}-${f.slice(oldId.length + 1)}`)]),
      [path.join(STORE, oldId), path.join(STORE, newId)],
    ];
    for (const [from, to] of candidates) {
      try {
        await fs.access(from);
        plan.push(`      file  ${path.basename(from)} -> ${path.basename(to)}`);
        fileMoves.push([from, to]);
      } catch { /* not present — a re-run, or a plugin installed from elsewhere */ }
    }
  }

  if (APPLY) {
    await client.query("COMMIT");
    for (const [from, to] of fileMoves) await fs.rename(from, to);
  } else {
    await client.query("ROLLBACK");
  }
} catch (err) {
  await client.query("ROLLBACK");
  console.error("Nothing was changed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}

console.log(plan.length ? plan.join("\n") : "Nothing to rename — no pre-rename plugin ids found.");
console.log(APPLY ? "\nApplied." : "\nDry run. Re-run with --apply to write.");

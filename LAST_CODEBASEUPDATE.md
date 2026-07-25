# Last Codebase Update — 2026-07-25 (follow-up)

Follow-up to the plugin table-naming validator (PR #68, merged): document the
migration/database conventions for plugin authors and repackage the official
`.nvplugin` artifacts so their bundled manifests carry `tablePrefix`.

## Docs (committed)

- `README.md` — new **"Migrations & database conventions"** subsection under the
  Plugin development guide. Consolidates every host-enforced rule with its NEC
  code: DDL-only (2010), paired up/down (2011), table naming + `tablePrefix` +
  reserved namespaces (2013), immutable applied migrations / checksum (2012),
  forward-only-updates-by-name, and no cross-boundary FKs. Replaced the earlier
  standalone "Table naming" paragraph.

## Repackaged artifacts (git-ignored — NOT committed)

- `plugins/packaged/nodevo-advanced-moderation-1.0.0.nvplugin` (amod_)
- `plugins/packaged/nodevo-forum-1.0.3.nvplugin` (forum_)
- `plugins/packaged/nodevo-messaging-1.0.0.nvplugin` (pm_)
- `plugins/packaged/nodevo-shoutbox-1.0.0.nvplugin` (sb_)

Repackaged via `node scripts/package-plugin.mjs <dir> plugins/packaged --no-build`
(only the manifest changed — server/web bundles untouched). Verified each bundled
`manifest.json` now contains its `tablePrefix`.

`nodevo-shoutbox-1.0.1.nvplugin` (the marketplace update-demo artifact) was
deleted — it existed only for update testing and had no 1.0.1 source manifest to
regenerate from. `plugins/packaged/` now holds exactly the four current-version
artifacts, all carrying `tablePrefix`.

## Verification

- Confirmed `tablePrefix` present in all four repackaged bundles (unzip →
  manifest.json).
- README docs-only change; no code touched this push.

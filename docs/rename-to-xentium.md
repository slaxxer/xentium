# Nodevo → Xentium

The product was renamed. This is what moved, what deliberately did not, and the
order an existing install has to be upgraded in.

## What was renamed

| | |
|---|---|
| Product name in docs, comments, banners and the five locale bundles | `Nodevo` → `Xentium` |
| Workspace scope, 14 packages and both apps | `@nodevo/*` → `@xentium/*` |
| Root package, dev script | `nodevo` → `xentium`, `nodevo.sh` → `xentium.sh` |
| Shared error class and its file | `NodevoError` → `XentiumError` |
| Prisma model (its `@@map` is unchanged) | `NodevoPluginMigration` → `XentiumPluginMigration` |
| Browser host object | `window.__NODEVO_HOST__` → `window.__XENTIUM_HOST__` |
| Signed marketplace headers | `X-Nodevo-*` → `X-Xentium-*` |
| Official plugin ids | `nodevo-forum` → `xentium-forum`, and the other four |
| Error codes | `NEC-<DOMAIN>-<CODE>` → `XEC-…` (106 of them) |
| Core table prefix | `ncf_` → `xcf_` (57 tables, migration `20260913140000_rename_ncf_to_xcf`) |

## What was NOT renamed, and why

These look like branding and are not. Each one costs a migration, a break, or a
silent security change, in exchange for a string no user reads.

- **`xt_` cookies**, **`xt-` CSS classes** (~700 occurrences), and the
  **`.xtplugin` / `.xttheme` / `.xtstyle`** extensions. Renaming the CSS prefix
  breaks every theme package and plugin stylesheet in the wild for a string
  nobody reads; renaming the cookies signs everyone out.
- ⚠ **`ncf_` and `NEC-` were on this list and are now renamed** (`xcf_`,
  `XEC-`). Both objections were about installations holding data and third
  parties holding plugins, and a pre-alpha reinstall is the one window where
  neither is true — a table prefix becomes a find-and-replace instead of a data
  migration. **`ncf_` remains RESERVED** to plugin migrations beside `xcf_`,
  because a database predating the rename still carries those tables.
- **`nodevo.secretbox.v1`**, the scrypt salt. It is frozen by design: change it
  and every stored secret becomes undecryptable.
- **`SOURCE_ID = "xentium.org"`**. It composes the live settings keys
  `marketplace.xentium.org.{token,accountRef,privateKey,publicKey,connectedAt}`.
  Renaming it orphans a connected instance's marketplace account and the signing
  keypair it registered. It moves with the marketplace, as a keyed migration.
- **`REDIS_KEY_PREFIX`**. A cold prefix silently un-revokes every revoked
  session — the revocation list lives under it.
- **The dev database role, name and docker volumes.** The existing volume owns
  role `nodevo`; renaming the volume starts an empty database.
- ⚠ The DDL ledger `xcf_plugin_migrations` and the import map’s `xentium_id`
  column were renamed too (migration `20260913150000_rename_nodevo_id_column`);
  no database object carries the old name any more.

## Compatibility, and when to drop it

Three aliases exist so nothing already deployed breaks. All three go after
`1.0.0-alpha`:

1. `window.__NODEVO_HOST__` still points at the host object. **Every plugin UMD
   bundle in the wild reads it by that name** — without the alias, every plugin's
   UI blanks until it is rebuilt.
2. `ctx.errors.NodevoError` still resolves to `XentiumError`, for plugin server
   bundles built against the old host.
3. Core sends BOTH sets of signed headers, and the marketplace accepts either.
   The header names are not part of the canonical signing string, so the two
   hosts can be deployed in any order.

And one that outlives them: `legacyPluginIds.ts` lets a **new** plugin id answer
to its **old** one when an entitlement is matched, because an entitlement issued
before the rename names the old product id. One direction only — nothing makes
an old id valid on its own, and a third-party plugin that happens to use a
`nodevo-` prefix is never assumed to be ours.

## Upgrading an existing install

In this order. Steps 2 and 3 are the ones that lose data if skipped.

1. **Deploy the renamed core** (both API and worker). Plugins keep running:
   they are still installed under their old ids, and the aliases cover the two
   identifiers their bundles read.
2. **Stop the API and worker**, then run the id migration from the repo root:

   ```bash
   node --env-file=.env scripts/rename-plugin-ids.mjs           # report only
   node --env-file=.env scripts/rename-plugin-ids.mjs --apply
   ```

   It is one transaction and idempotent; the file moves happen only after it
   commits. It renames the installed-plugin rows, the applied-migration ledger
   (whose ids embed the plugin id — leave it behind and every migration re-runs
   against tables that already exist), nav-item ownership, layout documents,
   settings, and every archive plus the extracted directory in the plugin store.
3. **Install the plugin packages built under the new ids.** A plugin's own
   bundle still carries its old id until it is rebuilt and repackaged. On a
   development box, after the step above:

   ```bash
   node --env-file=.env scripts/dev-install-packaged.mjs --apply
   ```

   It exists because the normal paths refuse this on purpose: `updatePlugin` is
   forward-only, so an install running 1.4.3 can never be moved to a freshly
   reset 1.0.0. Order matters — archives are matched by manifest id, and
   `plugins/packaged/` still holds the pre-rename artifacts.
4. Start the services and confirm each plugin is enabled and its pages render.

## Still outside this repo

- **npm.** Seven packages are published under `@nodevo/*` at `1.0.0-alpha.0/1`.
  Publish `@xentium/*` and deprecate the old scope with a pointer.
- **The GitHub repository**, and the `repository` fields and doc links that name
  it. GitHub redirects the old path, so this can happen at any time.
- **The marketplace catalogue**: product ids for the five official plugins, and
  the artifacts served for them. All five are reset to **1.0.0** — the public
  series starts there, and each plugin's CHANGELOG says so above its
  development history.
- **`xentium.org`** in the ACP's licence copy — a domain, not a string. Point it
  wherever the marketplace actually lives before changing the words.
- **Ops names**: deploy directory, systemd units, nginx site, database role and
  name. All cosmetic, all requiring a coordinated restart.

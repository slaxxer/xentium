# Changelog

## Architecture cleanup: semver dedup, cached single-setting reads, plugin lifecycle lock

- **Shared semver compare** — the numeric-core `compareSemver` now lives once in
  `shared/utils/semver.ts`; the plugin engine and the admin update-reconciliation
  path both import it instead of carrying their own copies.
- **`GET /admin/settings/:key` no longer loads every setting** — it reads the one
  key through the cached settings service, with the same defaults-merge behavior
  as the full settings list.
- **Plugin lifecycle operations are now serialized** — install, update, enable,
  disable, and uninstall run through a per-process lock, so two admins can no
  longer race e.g. an update's disable→swap→re-enable sequence into a corrupted
  plugin directory. A raced duplicate update fails cleanly with NEC-PLUGIN-2005.
- Removed a dead empty file (`permissions.repository.ts`).
- Docs: 2026-07-21 architecture re-audit appended to `docs/architecture-review.md`
  (addendum §A1–A6) covering the codebase after the marketplace/update-pipeline
  and ACP-i18n waves.

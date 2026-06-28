# Changelog

## Plugin foundation — i18n SDK + security/moderation host APIs

Developer-facing plugin foundation (core stores & exposes; the plugin treats):

### Plugin i18n SDK
- `registerPluginTranslations` bridge (`@web/plugins/pluginI18n` via host-globals) — plugins bundle `web/locales/<lng>/<ns>.json` and share the host i18next instance; no HTTP fetch, no server packaging.
- New `docs/plugin-i18n.md` recipe and a "Plugin foundation" section in `CONTRIBUTING.md`.

### Web slot surface
- `slotRegistry`: `registerModCanvasSection` / `registerUserDetailPanel` / `registerIpEnrichment`; slots auto-deregister on plugin disable.
- Plugin web bundles now load with version cache-busting so updates take effect immediately.

### Server hooks (`@nodevo/plugin-sdk`)
- `host.security.createCase` / `autoBanMultiaccounts` and `ctx.registerSecurityScan`.
- Core `core/security` scan registry (per-plugin, deregistered on disable) + generic "Security scans" cadence — core ships no detection of its own.
- Worker now initializes enabled plugins before scheduling jobs.
- Plugin load errors are tracked and surfaced on the Installed ACP page.

### Moderation — "core stores, plugin treats"
- `moderationCase.service` + `moderation.service` host helpers; the cases review UI moved out of core (`ModCanvas`/`UserDetailPage` now render plugin slots), and device cookies / sessions are split into their own user mod tabs.

### Also included
- In-flight core work present in the tree: fatal-error overlay, `CanonicalManager`, appearance draft-publish job, installer/error-log/maintenance refinements, and the `docs/v1-spec.md` single-source spec.
- `.gitignore`: ignore `**/var/geoip/` (large licensed MaxMind binaries, downloaded at runtime).

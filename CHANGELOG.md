# Changelog

## Security: baseline abuse detection is core again (§15)

The four §15 detection patterns now ship **built into core** — a plain install detects abuse
out of the box, and the `security-analysis` job is no longer a no-op without plugins.

- **Four baseline patterns** (`core/security/patterns.ts`), fixed spec thresholds, every
  30 minutes: rapid login attempts (3+ failures/IP/10 min), multi-account suspicion (2+
  accounts on one device cookie), registration burst (5+ registrations/IP/24 h), ban evasion
  (new account ≤10 min after a ban from the banned user's IP). Informational review cases
  only — no auto-action, no single-signal bans. The moderator exception whitelist is
  respected, including flagging new accounts that appear beyond a granted exception.
- **Per-pattern toggles** in ACP → Moderation → Settings (new "Detection Patterns" card,
  settings `security.pattern.<type>`, default on; translated in all 5 languages).
- **Review UI is core again**: ACP → Moderation → **Review Cases** (`/admin/cases`) and the
  ModCanvas **Cases** tab (open-case badge counts into the floating trigger). Both surfaces
  work with zero plugins installed.
- **New SDK extension point — pattern claims**: `ctx.claimSecurityPatterns([types])` lets a
  plugin replace individual core baselines with enhanced variants; core skips claimed
  patterns while the plugin is enabled and the baseline resumes automatically on disable.
  (`ctx.registerSecurityScan` unchanged.) The multi-account baseline scan is bounded (only
  cookies active in the last 24 h), and ban-evasion signals name the username, not an id.
- New doc: `docs/security-detection.md` (pipeline, patterns, extension points, operational
  notes — including that plugin registrations are in-memory and rebuilt at startup).

## SEO: canonical/OG meta served in HTML

- **`serveWeb.ts`** (new): in production the API serves the built SPA and injects
  per-request `<link rel="canonical">`, Open Graph (`og:url/type/site_name/title`) and
  `twitter:card` tags plus the site title from settings — so crawlers and link unfurlers see
  correct meta without JavaScript. Mounted before the install guard; skips `/api` +
  `/uploads`; optional `WEB_DIST` env. Dev parity on `:5173` via a Vite `transformIndexHtml`
  plugin.
- Fresh-install polish: the badge-glow bootstrap no longer fires (and 503s) before the
  instance is installed.

## Architecture: bottlenecks fixed + repetition removed

- **Hot-path bottlenecks:**
  - Settings reads are now **TTL-cached (15 s) and batchable** (`getSetting` / `getSettings` /
    `getFreshSetting` / `bustSettingsCache`) — the maintenance guard alone was a DB query on
    **every** `/api` request; site config, maintenance status, and the web shell now resolve
    their settings in one batched query. Cache busts are wired into every same-process writer.
    Appearance reads stay deliberately fresh so live style sync can never serve stale tokens.
  - `/appearance/css` is **memoized on the style version** instead of rebuilding per request;
    `admin.setSetting` now bumps the style version for `appearance.*` keys, so Style-Editor
    font saves invalidate the memo and propagate to clients live (was silently stale).
  - New `memoTtl` util (`memoTtl` + `TtlCache`) backs these in-process caches.
- **Repetition removed:**
  - **Express 5 cleanup** — ambient request typing (`req.userId` / `req.sessionId` /
    `req.file.detectedExt` via `types/express.d.ts`); all six copy-pasted `wrap()` helpers and
    every `AuthedRequest` / `(req as any)` cast deleted. Controllers are plain async handlers
    (Express 5 forwards rejections to the error middleware).
  - **Pagination unified** — 18 hand-rolled `{page,limit,total,totalPages}` metas across
    admin, moderation, notifications, invite, and beta replaced by `buildPaginationMeta`
    (single meta producer; consistent `hasPrev`/`hasNext`, `totalPages` ≥ 1), with
    `paginate()` as the list-endpoint pattern.
  - **UserRef dedup** — the one way responses name a user: shared select/mapper
    (`shared/utils/userRef.ts`, `UserRef` type in `@nodevo/contracts`) collapsed ~37
    hand-built badge-color selects/mappers in the admin and moderation services.

# Changelog

## Groups: configurable username "glow" (badge text-shadow)

- Per-group **username glow**, configured on the group itself (**ACP → Groups → create/edit
  group**): an on/off toggle plus an independent glow **colour** (defaults to the badge colour) and
  **X / Y / blur** offsets, with a live preview. Stored on `GroupProgression`
  (`badge_text_shadow`, `badge_shadow_color`, `badge_shadow_x/y/blur`; migration
  `20260709000000`). Default glow is `1px 1px 20px` in the badge colour.
- The **Badge section moved out of the Progression editors** into the group create/edit modals —
  badge label, colour and glow now live in one place (ACP → Groups). The standalone Progression page
  and the per-group progression modal keep only ladder placement, thresholds and content limits.
- Implemented at the single `Username` chokepoint (not threaded through every endpoint): an app-wide
  map of *badge colour → assembled `text-shadow`* is populated once at boot from `/members/groups`
  (which now returns each group's full glow config); `Username` applies the shadow when its resolved
  colour matches. Because the glow lives in the shared component, it renders **everywhere a username
  shows — core and plugins alike**: forum, articles, comments, member directory + hall-of-fame,
  who's-online footer, followers/following, search, mod log and ModCanvas.

## Auth: login method, failed-login lockout, name registration, username history

### Login (ACP → Settings → Login)
- Admins choose the sign-in identifier: **email**, **username**, or **either** (`auth.login_method`).
  The login form adapts its label/type; the service resolves the account accordingly.
- **Failed-login lockout**: after N failed attempts (`auth.lockout_max_attempts`) the identifier is
  blocked for M minutes (`auth.lockout_duration_minutes`), toggleable (`auth.lockout_enabled`).
  Rolling Redis counter (cross-process); a NEC-AUTH-1040 (429) response drives a toast that shows
  the server's message (retry window). The lockout error carries the attempted username + source IP
  as details, so the error log records who was targeted and from where. Every attempt
  (success + failure) is also audited to `ncf_login_events` (identifier + IP + user-agent + time).

### Registration (ACP → Settings → Registration)
- Optional **name** collection (`registration.collect_name`, `registration.name_required`) for
  article-CMS setups — stored as `User.displayName`, shown on the profile. Register form adds an
  (optionally required) Name field when enabled.
- Users choose in **Privacy** whether their profile shows their **full name** or **username**
  (`displayNamePreference`); the username always remains the @handle. Control appears only when a
  display name is set.

### Username history ("previously known as …")
- Profiles show a member's recent former usernames, admin-toggled
  (`profile.show_previous_usernames`) with a rolling window (`profile.previous_username_days`,
  default 90). This is **not** a privacy setting — members cannot hide it. Backed by the existing
  `ncf_username_history` (already written on every username change).

No schema migration: reuses `User.displayName`, `ncf_username_history`, `ncf_login_events`, the
JSON privacy blob, and the key-value settings table.

## Site footer: server stats + plugin stat registry

- New `GET /api/site/footer` — site name (copyright), Node process uptime, and plugin-contributed
  counters. Plugin stats are aggregated through a new **stat-source registry** (`registerStatSource`
  in the plugin SDK / `PluginContext`, mirroring the home-feed & search registries) so core never
  queries plugin tables; sources are removed automatically on plugin disable. 30s server-side cache
  on the aggregation (footer renders on every page).
- Footer rework (`SiteFooter`): removed the redundant "Online now" tile (the Who's online block
  already sits above it); renders plugin-contributed counters; new bottom row with a
  copyright line (`© <year> <site name>`), a live-ticking server **uptime**, and **latency**
  (client-measured round-trip to the API).

## Core: layout-widget slot + generic moderation report upgrade

### Layout-widget slot
- New `layoutWidget` slot (`slotRegistry.registerLayoutWidget`) + generic `LayoutWidgetOutlet`
  mounted in `AppLayout` (top, inside `.app-main` above the routed page) and the home rail —
  reusable by any plugin; widgets decide their own placement per outlet/route.

### Moderation report upgrade (generic)
- `ncf_moderation_reports` gains `target_user_id` (author of the reported content) and
  `content_snapshot` (text captured at filing time — reports stay reviewable after the content is
  deleted/pruned). Snapshots are written server-side only, never accepted from clients.
- ModCanvas Reports queue shows the snapshot and, when the target user is known, offers **Warn**
  and **Ban** quick actions inline (existing endpoints; a successful action resolves the report).

## Plugin install page (ACP → Extensions → Upload)

- Wider two-column layout (install card + sidebar boxes: how-it-works, requirements, safety,
  Marketplace link) instead of a single small card.
- Live processing feedback: an indeterminate progress bar + spinner while validating/installing,
  a pulsing active step, and inline button spinners. A minimum display duration keeps the animation
  visible even when local installs finish instantly.

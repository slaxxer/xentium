# Nodevo API Reference

REST API for the Nodevo core. This documents the **core** surface as mounted in
`apps/api/src/app/app.ts`. Official plugins (e.g. the Forum) register their own routes at
runtime under `/api/p/<pluginId>/*` and are documented by the plugin, not here.

- **Base path:** all routes are under `/api`.
- **Format:** JSON request/response bodies. `Content-Type: application/json` unless an
  endpoint takes a file (`multipart/form-data`, noted per endpoint).
- **Last verified:** 2026-06-02 against the route files. When in doubt the route files are
  the source of truth.

---

## Conventions

### Authentication

Two tokens (see §43 of the reference doc):

| Token | Transport | Lifetime |
|---|---|---|
| **Access token** (RS256 JWT) | `Authorization: Bearer <token>` header | 15 min |
| **Refresh token** (opaque) | `HttpOnly; Secure; SameSite=Strict` cookie, scoped to `/api/auth` | 30 days, rotated on every refresh |

Flow: `POST /api/auth/login` returns `{ accessToken }` in the body and sets the refresh
cookie. When the access token expires, call `POST /api/auth/refresh` (sends the cookie, no
body) to get a new access token and a rotated cookie. The browser never stores the refresh
token in JS; the access token is held in memory only.

**Auth levels used in this doc:**

| Marker | Meaning |
|---|---|
| **Public** | No auth required |
| **Optional** | Works logged-out; richer response / visibility when a valid Bearer token is sent (`optionalAuth`) |
| **Auth** | Valid Bearer access token required (`requireAuth`) |
| **Perm:`key`** | Auth **plus** the named permission key (`requirePermission`) |
| **Admin** | Auth **plus** `admin.access` (`adminGuard`) |

### Install guard

Until the site is installed (`settings['site.id']` unset), every route **except**
`/api/install/*` and `/api/health` returns `NEC-INSTALL-*` and the client is redirected to
the installer. After install, `/api/install/*` returns `410 Gone`.

### Pagination

List endpoints accept the standard contract (`@nodevo/contracts`):

```
?page=1        1-based, default 1
&limit=20      default 20, max 100
&sort=field    optional
&order=desc    "asc" | "desc", default "desc"
```

and return:

```jsonc
{
  "data": [ /* T[] */ ],
  "meta": { "page": 1, "limit": 20, "total": 0, "totalPages": 0, "hasNext": false, "hasPrev": false }
}
```

### Error envelope

Every error returns a consistent shape with an HTTP status and a NEC code:

```jsonc
{ "error": { "code": "NEC-API-4003", "message": "Forbidden", "details": { /* optional */ } } }
```

| Condition | Status | Code |
|---|---|---|
| Zod validation failed | `422` | `NEC-API-4001` (`details` = field issues) |
| Forbidden (missing permission) | `403` | `NEC-API-4003` |
| Not found | `404` | `NEC-API-4004` |
| Conflict | `409` | `NEC-API-4009` |
| Rate limit exceeded | `429` | `NEC-API-4290` (with `Retry-After`) |
| Unhandled server error | `500` | `NEC-API-5000` (message hidden in prod) |

Full code catalog: ACP → System → Error Reference, or `packages/contracts/src/nec.ts`.

### Rate limits

Redis-backed (`§26`). Notable limiters: `auth/login` 10/15m, `auth/register` 5/h,
`auth/password-reset` 3/h, `auth/refresh` 20/m, `users/:id/follow` 30/m (per user),
`users/:id/profile-comments` 10/5m (per user), `plugins/upload` 20/h,
`admin/license/activate` 5/h, plus a coarse global per-IP API limiter in production.
All emit `429 NEC-API-4290`.

---

## Health

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | Public | Liveness probe → `{ status: "ok" }`. Exempt from the install guard. |
| GET | `/api/admin/health` | Admin | Deep health: DB / Redis / queue / storage / email status + `overall`. |

## Installer — `/api/install` (pre-install only)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/status` | Public | Install state (`installed`, current step). |
| GET | `/environment` | Public | Environment checks (Node, PostgreSQL, Redis, disk, OpenSSL). |
| POST | `/database` | Public | Save DB config. |
| GET | `/database/test` | Public | Test the DB connection. |
| POST | `/site` | Public | Site config; generates RS256 auth keypair + refresh secret into `.env`. |
| POST | `/admin` | Public | Create the first admin account. |
| POST | `/finalize` | Public | Run `migrate deploy` + seed, write `site.id`, lock the installer. |

## Auth — `/api/auth`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/registration-status` | Public | Whether registration / invite / beta gating is open. |
| POST | `/register/send-code` | Public | Email a verification code to begin registration. |
| POST | `/register` | Public | Create an account (with the emailed code + optional profile fields). |
| POST | `/login` | Public | `{ email, password, loginPin? }` → `{ accessToken }` (+ refresh cookie). May return `{ requiresPin: true }`. |
| POST | `/refresh` | Cookie | Rotate the refresh cookie, issue a new access token. |
| POST | `/password-reset` | Public | Request a reset link. **Always 200** (no account enumeration). |
| POST | `/password-reset/confirm` | Public | `{ token, password }` → set new password, revoke all sessions. |
| POST | `/logout` | Cookie | Revoke the current session + clear the cookie. |
| GET | `/me` | Auth | Current user + groups + effective context. |

## Account (self-service) — `/api/account`

All **Auth**.

| Method | Path | Description |
|---|---|---|
| PATCH | `/profile` | Update display name / bio. |
| POST | `/avatar` | Upload avatar (`multipart`, field `file`). |
| PATCH | `/username` | Change username (cooldown enforced). |
| POST | `/email` | Request an email change (sends a code). |
| POST | `/email/verify-code` | Confirm the email change. |
| POST | `/password` | Change password (revokes all other sessions). |
| GET | `/sessions` | List active sessions (device / IP / last seen). |
| DELETE | `/sessions/:sessionId` | Revoke one session. |
| GET / PATCH | `/privacy` | Read / update privacy settings (JSON). |
| GET | `/username-history` | Own username change log. |
| GET / PATCH | `/profile-fields` | Read / update own custom-field values (with per-field privacy). |
| POST / DELETE | `/pin` | Set / disable the login PIN. |
| GET / PATCH | `/notifications` | Read / update notification preferences. |

## Users — `/api/users`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/profile-fields` | Public | Custom profile-field **definitions**. |
| GET | `/search` | Auth | User search (typeahead). |
| GET | `/me/limits` | Auth | Effective content limits from progression config. |
| GET | `/me/blocks` | Auth | Own block list. |
| GET | `/:username` | Optional | Public profile (respects privacy). |
| GET | `/:id/followers` | Optional | Paginated followers (403 if owner hid the list). |
| GET | `/:id/following` | Optional | Paginated following (403 if hidden). |
| GET | `/:id/profile-fields` | Optional | A user's field values, filtered by privacy + viewer. |
| GET | `/:id/profile-comments` | Optional | Profile wall (includes tombstoned rows). |
| POST | `/:id/profile-comments` | Auth (rate-limited) | Post on a wall. |
| PUT | `/profile-comments/:commentId` | Auth | Edit own comment (within edit window). |
| DELETE | `/profile-comments/:commentId` | Auth | Delete (own / wall-owner). |
| POST / DELETE | `/profile-comments/:commentId/like` | Auth | Like / unlike. |
| POST / DELETE | `/:id/follow` | Auth (rate-limited) | Follow / unfollow. |
| POST / DELETE | `/:id/block` | Auth (rate-limited) | Block / unblock (removes follows both ways). |

## Articles — `/api/articles`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | Optional | List published articles (filter by category/tag; visibility-aware). |
| GET | `/me` | Auth | Own articles (any status). |
| GET | `/:slug` | Optional | Read one (visibility-aware). |
| POST | `/` | Perm:`article.create` | Create. |
| PATCH | `/:id` | Auth (owner/admin) | Update. |
| POST | `/:id/publish` | Auth | Publish (transactional; sets `published_at`, bumps `article_count`). |
| POST | `/:id/unpublish` | Auth | Revert to draft. |
| DELETE | `/:id` | Auth (owner/admin) | Soft-delete. |
| GET | `/:id/revisions` | Auth | Revision history. |
| POST | `/:id/view` | Public | Register a view (deduped per IP). |
| POST | `/:id/featured-image` | Auth | Upload featured image (`multipart`, field `file`). |
| GET | `/:id/comments` | Public | List comments (tombstones included). |
| POST | `/:id/comments` | Perm:`article.comment.create` | Add a comment. |
| POST / DELETE | `/:id/like` · `/:id/dislike` | Auth | Like/dislike toggles. |

### Article comments — `/api/article-comments`

| Method | Path | Auth | Description |
|---|---|---|---|
| PATCH | `/:commentId` | Auth | Edit own comment. |
| DELETE | `/:commentId` | Auth | Delete (own / moderator → tombstone). |
| POST / DELETE | `/:commentId/like` | Auth | Like / unlike. |

### Article categories — `/api/article-categories`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | Optional | Category tree (visibility-aware). |
| POST | `/` | Admin | Create. |
| PATCH | `/:id` | Admin | Update (incl. access control). |
| PATCH | `/reorder` | Admin | Reorder / reparent. |
| DELETE | `/:id` | Admin | Delete (with child/article handling). |

## Search — `/api/search`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/?q=&type=&page=&limit=` | Optional | Full-text search. `type` = `all` \| `articles` \| `users` (plugins add types, e.g. `forum`). Visibility filtered in SQL. |

## Notifications — `/api/notifications`

All **Auth**.

| Method | Path | Description |
|---|---|---|
| GET | `/` | List (paginated). |
| GET | `/unread-count` | Unread badge count. |
| POST | `/read-all` | Mark all read. |
| PATCH | `/:id/read` | Mark one read. |

## Moderation — `/api/moderation`

Each route is gated by its specific `moderation.*` permission.

Review cases (`/cases*`) are produced by the core `security-analysis` job — four built-in
baseline abuse patterns (rapid logins, multi-account, registration burst, ban evasion),
informational only, with per-pattern `security.pattern.*` settings toggles. Plugins can add
scans or replace baselines via the SDK. Full pipeline: [security-detection.md](security-detection.md).

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/reports` | Auth | File a report (any target type). |
| GET | `/summary` | Auth | ModCanvas badge counts. |
| GET | `/reports` | Perm:`moderation.report.manage` | Report queue. |
| PATCH | `/reports/:id` | Perm:`moderation.report.manage` | Update report status. |
| GET | `/warnings` · POST `/warnings` | Perm:`moderation.warn` | List / issue warnings. |
| PATCH | `/warnings/:id/pardon` | Perm:`moderation.warn` | Pardon. |
| GET | `/bans` · POST `/bans` | Perm:`moderation.ban` | List / issue bans. |
| PATCH | `/bans/:id/lift` | Perm:`moderation.ban` | Lift a ban. |
| GET | `/cases` | Perm:`moderation.cases.manage` | Review cases. |
| PATCH | `/cases/:id` · POST `/cases/:id/ban-all` | Perm:`moderation.cases.manage` | Update / bulk-ban. |
| GET | `/log` | Perm:`moderation.log.view` | Moderation log. |
| DELETE | `/comments/article/:id` · `/comments/profile/:id` | Perm:`moderation.*` | Soft-delete with reason → tombstone. |

## Appearance — `/api/appearance`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/css` | Public | Compiled token CSS (injected on page load), emitted **scope-keyed** — see below. |
| GET / PUT | `/tokens` | Admin | Read / save style tokens (scope-keyed map per theme; legacy flat = `global`). |
| GET | `/version` | Public | Style version + poll interval for live theme sync. |
| GET | `/style-packs` · POST (`multipart`) · POST `/:id/activate` · DELETE `/:id` | Admin | `.nvstyle` lifecycle. |
| POST | `/history/:id/restore` | Admin | Restore a style-history snapshot. |
| GET | `/branding` | Public | Resolved logo URLs + site name. |
| POST | `/branding/:variant` (`multipart`) · DELETE `/branding/:variant` | Admin | Logo upload / reset (`variant` = `navbar` \| `icon`). |
| PUT | `/branding/text` | Admin | Toggle site-name text in nav. |

### Theming tokens & scoped CSS

All visual values are CSS custom properties resolved at runtime — three tiers, defined in
`apps/web/src/styles/tokens.scss`, with the contract in `@nodevo/contracts` → `TOKEN_REGISTRY`:

| Tier | Prefix | Examples |
|---|---|---|
| Semantic (palette) | `--c-*` | `--c-bg`, `--c-accent`, `--c-fg`, `--c-card` |
| Region | `--<region>-*` | `--nav-bg`, `--footer-bg`, `--content-bg`, `--aside-bg` |
| Component | `--<component>-*` | `--btn-bg`, `--card-bg`, `--input-bg`, `--menu-bg` |

- **Inheritance:** region/component tokens default to a semantic token
  (`--nav-bg: var(--c-surface)`), so editing the palette cascades; a token is overridden only when
  that surface must differ. Tokens cover every facet (fill, border + per-side, radius, shadow).
- **Per-region scoping:** `GET /css` emits overrides scope-keyed — `global` tokens on the theme
  root (`:root, [data-theme="light"]`), region scopes under that region's selector
  (`:root .pub-nav, [data-theme="light"] .pub-nav { … }`). Because custom properties inherit down
  the DOM, a region re-scopes a component token (e.g. `.pub-nav { --btn-bg }` themes only navbar
  buttons) — no per-region token names.
- **Storage:** `PUT /tokens` takes a scope-keyed map per theme (`{ global: {…}, navbar: {…} }`);
  legacy flat maps load as the `global` scope (back-compat). Saved keys are validated against the
  registry.
- **Contributors:** add a `TokenDef` to `TOKEN_REGISTRY` + define it in `tokens.scss` (defaulting
  to its semantic base); never hardcode a literal. See **[CONTRIBUTING → Theming tokens](../CONTRIBUTING.md#theming-tokens)**.

## Public nav

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/nav-items` | Public | Active nav items ordered by position (visibility filtered client-side). |

## Online presence

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/online` | Public | Currently-online users grouped by group. |

## Plugin management — `/api/plugins`

All **Admin**.

| Method | Path | Description |
|---|---|---|
| GET | `/` | Installed plugins + status. |
| POST | `/validate` | Dry-run validate an uploaded `.nvplugin` (`multipart`, field `file`). |
| POST | `/upload` | Install (rate-limited; `multipart`). |
| POST | `/:id/enable` | Enable (checks entitlement for licensed plugins). |
| POST | `/:id/disable` | Disable (data preserved). |
| DELETE | `/:id?removeData=` | Uninstall (optionally reverse migrations). |

## Plugin runtime

| Method | Path | Auth | Description |
|---|---|---|---|
| * | `/api/p/:pluginId/*` | per plugin | Routes registered by an enabled plugin. A guard returns `404 NEC-PLUGIN-2020` when the plugin is disabled. |

---

## Admin (ACP) — `/api/admin`

All routes below are **Admin** (`admin.access`) unless a stricter permission is noted.

### Dashboard & users

| Method | Path | Description |
|---|---|---|
| GET | `/dashboard` | ACP dashboard stats. |
| GET | `/users` · `/users/:id` | User list / detail (incl. raw private fields for admin/supermod). |
| PUT | `/users/:id/groups` | Set group membership. |
| PATCH | `/users/:id/active` | Activate / deactivate. |
| POST | `/users/:id/ban` · DELETE `/users/:id/ban` | Ban / lift. |
| POST | `/users/:id/force-logout` | Revoke all sessions. |
| POST | `/users/:id/password-reset` | Send a reset email. |

### Profile fields

| Method | Path | Description |
|---|---|---|
| GET | `/profile-fields` | List field schema. |
| POST · PATCH `/:id` · DELETE `/:id` | Create / update / delete (system fields undeletable). |
| PUT | `/profile-fields/reorder` | Reorder. |

### Access control (sub-mounted)

| Method | Path | Description |
|---|---|---|
| GET·POST·PATCH·DELETE | `/groups` · `/groups/:id` | Group CRUD; `PUT /groups/:id/permissions`; `POST /groups/:id/icon` (`multipart`). |
| GET | `/permissions` | Full permission catalog (incl. plugin-registered). |
| GET·PATCH | `/progression` · `/progression/:id` | Ladder + per-group progression; `/progression/groups`, `PATCH /progression/settings`, `PATCH /progression/reorder`. |

### Content & moderation (ACP views)

| Method | Path | Description |
|---|---|---|
| GET | `/articles` · DELETE `/articles/:id` | Article admin list / delete. |
| GET | `/reports` · PATCH `/reports/:id` | Report queue. |
| GET | `/warnings` · POST · PATCH `/warnings/:id/pardon` | Warnings. |
| GET | `/bans` | Bans list. |
| GET | `/cases` · PATCH `/cases/:id` · PATCH `/cases/:id/notes` · POST `/cases/:id/ban-all` · POST `/cases/:id/revoke-exception` | Review cases. |
| GET | `/modlog` | Moderation log. |
| DELETE | `/comments/article/:id` · `/comments/profile/:id` | Mod soft-delete. |

### Extensions & licensing

| Method | Path | Description |
|---|---|---|
| GET | `/installed-plugins` | Installed plugins (ACP view). |
| GET | `/license` · POST `/license/activate` (rate-limited) · POST `/license/refresh` · DELETE `/license` | Manual license-key lifecycle. |
| GET | `/marketplace/plugins` | Catalogue mirror (paginated). |
| GET·POST·DELETE | `/marketplace/connection` | Account connection state / connect / disconnect. |
| POST | `/marketplace/authorize` | The download gate → `AuthorizedDownload` (rate-limited). |
| GET | `/registered-pages` | Plugin-registered ACP pages (drives ACP nav). |

### System

| Method | Path | Description |
|---|---|---|
| GET | `/settings` · `/settings/:key` · PUT `/settings/:key` | Platform settings. |
| GET | `/error-log` · DELETE `/error-log` | Error log (filterable) / clear. |
| GET | `/migration-history` | `migration_runs` table. |
| GET | `/style-history` | Style snapshots. |
| GET | `/nec-codes` | NEC code catalog (for the Error Reference page). |
| GET·POST·PATCH·DELETE | `/nav-items` … `/nav-items/reorder` | Frontend nav manager. |

### Beta / invites (deployment gating)

> Not part of §17 — added for gated beta deployments.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/beta/status` | Optional | Beta-gate state for the current visitor. |
| POST | `/api/beta/redeem` · `/api/beta/log-visit` | Public/Optional | Redeem a beta code / log a visit. |
| GET·POST·DELETE | `/api/admin/beta-codes` (+ `/log`) | Admin | Beta code management + visit log. |
| GET·POST·DELETE | `/api/admin/invites` | Admin | Invite management. |

---

## Notes & known deviations from §17

- Self-service account actions live under **`/api/account`**, not `/api/users/me/*`.
- Groups / permissions / progression are sub-mounted under **`/api/admin`**, not top-level
  `/api/groups` etc.
- Licensing is under **`/api/admin/license`** + `/api/admin/marketplace` (ADR 0001/0002);
  there is no top-level `/api/licenses`.
- **Beta / invite** routes are an addition for gated deployments and are not in the
  original §17 plan.
- There is **no machine-readable OpenAPI spec** yet — this hand-maintained reference is the
  v1 contract. Generating OpenAPI from the route + Zod schemas is a post-v1 candidate.

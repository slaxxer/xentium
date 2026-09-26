# API reference

The REST API of Xentium core, as mounted in `apps/api/src/app/app.ts`. Plugins register
their own routes at runtime under `/api/p/<pluginId>/*`, and each plugin documents those
itself.

- **Base path:** everything is under `/api`.
- **Format:** JSON in and out, `Content-Type: application/json`, except endpoints that take
  a file (`multipart/form-data`, noted on each one).
- **Last checked** against the route files: 2026-09-19 (appearance, themes, layouts),
  2026-08-23 (licensing and marketplace), 2026-06-02 (the rest). If this page and the route
  files disagree, the route files win.

---

## Conventions

### Authentication

There are two tokens:

| Token | How it's sent | Lifetime |
|---|---|---|
| **Access token** (HS256 JWT) | `Authorization: Bearer <token>` header | 15 minutes |
| **Refresh token** (opaque) | `HttpOnly; Secure; SameSite=Strict` cookie, scoped to `/api/auth` | 30 days, rotated on every refresh |

`POST /api/auth/login` returns `{ accessToken }` in the body and sets the refresh cookie.
When the access token expires, call `POST /api/auth/refresh` (it sends the cookie, no
body) to get a new access token and a new cookie. The browser never has the refresh token
in JavaScript, and it keeps the access token in memory only.

**What the Auth column means on this page:**

| Marker | Meaning |
|---|---|
| **Public** | no login needed |
| **Optional** | works logged out; you get more (or see more) with a valid Bearer token (`optionalAuth`) |
| **Auth** | needs a valid Bearer token (`requireAuth`) |
| **Perm:`key`** | logged in **and** holding that permission (`requirePermission`) |
| **Admin** | logged in **and** holding `admin.access` (`adminGuard`) |

### Install guard

Until the site is installed (`settings['site.id']` isn't set), every route **except**
`/api/install/*` and `/api/health` returns an `XEC-INSTALL-*` error, and the web app sends
you to the installer. Once installed, `/api/install/*` returns `410 Gone`.

### Pagination

List endpoints all take the same parameters (from `@xentium/contracts`):

```
?page=1        starts at 1, default 1
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

### Errors

Every error has the same shape, with an HTTP status and an XEC code:

```jsonc
{ "error": { "code": "XEC-API-4003", "message": "Forbidden", "details": { /* optional */ } } }
```

| When | Status | Code |
|---|---|---|
| Zod validation failed | `422` | `XEC-API-4001` (`details` lists the field issues) |
| Forbidden (missing permission) | `403` | `XEC-API-4003` |
| Not found | `404` | `XEC-API-4004` |
| Conflict | `409` | `XEC-API-4009` |
| Rate limit hit | `429` | `XEC-API-4290` (with `Retry-After`) |
| Unhandled server error | `500` | `XEC-API-5000` (message hidden in production) |

The full list of codes is in the ACP under System → Error Reference, and in
`packages/contracts/src/nec.ts`.

### Rate limits

Stored in Redis. The notable ones: `auth/login` 10 per 15 min, `auth/register` 5 per hour,
`auth/password-reset` 3 per hour, `auth/refresh` 20 per minute, `users/:id/follow` 30 per
minute (per user), `users/:id/profile-comments` 10 per 5 min (per user), `plugins/upload`
20 per hour, plus a general per-IP limit on the whole API in production. All of them
answer `429 XEC-API-4290`.

---

## Health

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | Public | Liveness check → `{ status: "ok" }`. Not blocked by the install guard. |
| GET | `/api/admin/health` | Admin | Detailed health: DB, Redis, queue, storage and email status, plus `overall`. |

## Installer: `/api/install` (before install only)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/status` | Public | Install state (`installed`, current step). |
| GET | `/environment` | Public | Environment checks (Node, PostgreSQL, Redis, disk, OpenSSL). |
| POST | `/database` | Public | Save the DB config. |
| GET | `/database/test` | Public | Test the DB connection. |
| POST | `/site` | Public | Site name, URL, language, timezone. |
| POST | `/admin` | Public | Create the first admin account. |
| POST | `/finalize` | Public | Run `migrate deploy` and the seed, write `site.id`, lock the installer. |

## Auth: `/api/auth`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/registration-status` | Public | Whether registration, invites or the beta gate are open. |
| POST | `/register/send-code` | Public | Email a verification code to start registering. |
| POST | `/register` | Public | Create an account (with the emailed code and optional profile fields). |
| POST | `/login` | Public | `{ identifier, password, loginPin?, remember? }` → `{ accessToken }` (plus the refresh cookie). Can return `{ requiresPin: true }`. `remember: false` gives a browser-session cookie and a session that ends 12 hours after its last use. |
| POST | `/login/pin` | Public | `{ ticket, pin }`: the PIN step after a sign-in link, passkey or provider. The ticket is single-use, lasts five minutes and burns after five wrong PINs. |
| POST | `/register/check-availability` | Public | `{ email?, username? }` → which are free. |
| POST | `/register/check-invite` | Public | `{ code }` → `{ valid }`. |
| GET | `/methods` | Public | `{ passkeys, magicLink, providers[] }`: which sign-in methods this site offers. |
| GET | `/doorway` | Public | Site name, member and online counts and this week's joiners for the sign-in page (members-only profiles are left out). |
| POST | `/magic-link` | Public | `{ email, remember? }`: email a one-time sign-in link. **Always 200.** |
| POST | `/magic-link/consume` | Public | `{ token }` → a session, or `{ requiresPin, ticket }`. |
| POST | `/passkey/login/options` · `/passkey/login/verify` | Public | Sign in with a passkey: options (`{ ceremonyId, options }`), then `{ ceremonyId, response, remember? }`. |
| POST | `/passkey/register/options` · `/passkey/register/verify` | Auth | Add a passkey: options, then `{ response, name? }`. |
| PATCH / DELETE | `/passkeys/:id` | Auth | Rename or remove a passkey. Removing the last way to sign in is refused (409). |
| GET | `/sign-in-methods` | Auth | Your password state, passkeys and connected providers. |
| POST | `/oauth/:provider/start` | Public | `{ remember?, returnTo? }` → `{ url }` to send the browser to (Google, GitHub, Discord). |
| POST | `/oauth/:provider/link` | Auth | Same, to connect the provider to your account. |
| DELETE | `/oauth/:provider` | Auth | Disconnect a provider (refused if it is your last way in). |
| GET | `/oauth/:provider/callback` | Public | Where the provider returns; redirects to the site with the outcome. Never carries a token. |
| POST | `/refresh` | Cookie | Rotate the refresh cookie and issue a new access token. |
| POST | `/password-reset` | Public | Request a reset link. **Always 200**, so nobody can probe which accounts exist. |
| POST | `/password-reset/confirm` | Public | `{ token, password }` → sets the new password and revokes every session. |
| POST | `/logout` | Cookie | Revoke the current session and clear the cookie. |
| GET | `/me` | Auth | The current user, their groups and context. |

## Account (your own): `/api/account`

All **Auth**.

| Method | Path | Description |
|---|---|---|
| PATCH | `/profile` | Update display name and bio. |
| POST | `/avatar` | Upload an avatar (`multipart`, field `file`). |
| POST / DELETE | `/cover` | Upload or remove the profile cover (`multipart`, field `file`). The allowed size and file types depend on the member's earned rank (see `profileImageLimits.ts`). An empty type list means "no per-rank restriction", not "nothing allowed". |
| PATCH | `/username` | Change username (with a cooldown). |
| POST | `/email` | Request an email change (sends a code). |
| POST | `/email/verify-code` | Confirm the email change. |
| POST | `/password` | Change password (revokes every other session). |
| GET | `/sessions` | Active sessions (device, IP, last seen). |
| DELETE | `/sessions/:sessionId` | Revoke one session. |
| GET / PATCH | `/privacy` | Read or update privacy settings (JSON). |
| GET | `/username-history` | Your own username changes. |
| GET / PATCH | `/profile-fields` | Read or update your custom field values (with per-field privacy). |
| POST / DELETE | `/pin` | Set or turn off the login PIN. |
| GET / PATCH | `/notifications` | Read or update notification preferences. |

## Users: `/api/users`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/profile-fields` | Public | Custom profile field **definitions**. |
| GET | `/search` | Auth | User search (typeahead). |
| GET | `/me/limits` | Auth | Your content limits from the progression config. |
| GET | `/me/blocks` | Auth | Who you've blocked. |
| GET | `/:username` | Optional | Public profile (respects privacy). |
| GET | `/:id/followers` | Optional | Followers, paginated (403 if the owner hid the list). |
| GET | `/:id/following` | Optional | Following, paginated (403 if hidden). |
| GET | `/:id/profile-fields` | Optional | A user's field values, filtered by privacy and by who's asking. |
| GET | `/:id/profile-comments` | Optional | Profile wall (deleted comments included as tombstones). |
| POST | `/:id/profile-comments` | Auth (rate-limited) | Post on a wall. |
| PUT | `/profile-comments/:commentId` | Auth | Edit your comment (within the edit window). |
| DELETE | `/profile-comments/:commentId` | Auth | Delete (your own, or on your wall). |
| POST / DELETE | `/profile-comments/:commentId/like` | Auth | Like / unlike. |
| POST / DELETE | `/:id/follow` | Auth (rate-limited) | Follow / unfollow. |
| POST / DELETE | `/:id/block` | Auth (rate-limited) | Block / unblock (removes follows in both directions). |

## Articles: `/api/articles`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | Optional | Published articles (filter by category or tag; respects visibility). |
| GET | `/me` | Auth | Your own articles, any status. |
| GET | `/:slug` | Optional | One article (respects visibility). |
| POST | `/` | Perm:`article.create` | Create. |
| PATCH | `/:id` | Auth (owner/admin) | Update. |
| POST | `/:id/publish` | Auth | Publish (in a transaction; sets `published_at` and bumps `article_count`). |
| POST | `/:id/unpublish` | Auth | Back to draft. |
| DELETE | `/:id` | Auth (owner/admin) | Soft-delete. |
| GET | `/:id/revisions` | Auth | Revision history. |
| POST | `/:id/view` | Public | Count a view (one per IP). |
| POST | `/:id/featured-image` | Auth | Upload the featured image (`multipart`, field `file`). |
| GET | `/:id/comments` | Public | Comments (tombstones included). |
| POST | `/:id/comments` | Perm:`article.comment.create` | Add a comment. |
| POST / DELETE | `/:id/like` · `/:id/dislike` | Auth | Like / dislike toggles. |

### Article comments: `/api/article-comments`

| Method | Path | Auth | Description |
|---|---|---|---|
| PATCH | `/:commentId` | Auth | Edit your comment. |
| DELETE | `/:commentId` | Auth | Delete (your own, or as a moderator, which leaves a tombstone). |
| POST / DELETE | `/:commentId/like` | Auth | Like / unlike. |

### Article categories: `/api/article-categories`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | Optional | The category tree (respects visibility). |
| POST | `/` | Admin | Create. |
| PATCH | `/:id` | Admin | Update (including access control). |
| PATCH | `/reorder` | Admin | Reorder / move. |
| DELETE | `/:id` | Admin | Delete (handles child categories and articles). |

## Search: `/api/search`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/?q=&type=&page=&limit=` | Optional | Full-text search. `type` is `all`, `articles` or `users`, and plugins add their own (e.g. `forum`). Visibility is filtered in SQL. |

## Notifications: `/api/notifications`

All **Auth**.

| Method | Path | Description |
|---|---|---|
| GET | `/` | List (paginated). |
| GET | `/unread-count` | The unread count for the badge. |
| POST | `/read-all` | Mark everything read. |
| PATCH | `/:id/read` | Mark one read. |

## Badges: `/api/user-badges` (public) and `/api/admin/badges` (ACP)

Which badges a site has is public; who holds what is answered per user.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/user-badges/batch?ids=a,b,c` | Public | Badges for many users in ONE request (up to 100 ids). The user card uses this, so a thread with twenty author cards is one request, not twenty. |
| GET | `/user-badges/catalogue` | Public | Every badge the site can award; the profile draws the unearned ones from this. No holder data. |
| GET | `/user-badges/:id` | Public | One user's badges, in card order. |
| GET / POST | `/admin/badges` | `badge.manage` | List / create badges. |
| PATCH / DELETE | `/admin/badges/:id` | `badge.manage` | Edit / delete. Deleting a badge removes every award of it too (`onDelete: Cascade`), and system badges can't be deleted. |
| GET | `/admin/badges/metrics` | `badge.manage` | What this site can measure right now: core's counters plus every metric from a **currently enabled** plugin. |
| GET | `/admin/badges/:id/holders` | `badge.assign` | Who holds it. |
| POST | `/admin/badges/:id/award` | `badge.assign` | Give it to a user (`{ userId, note? }`). It's an upsert, so giving it twice keeps one badge and updates the note. |
| DELETE | `/admin/badges/:id/award/:userId` | `badge.assign` | Take it away. |

There are two permissions on purpose: `badge.manage` changes which badges exist,
`badge.assign` hands them out. A site can let someone do the second without the first.

`faIcon` stores an **icon token** (`"star"`, or `"jelly-regular:star"` to pin a style).
The old camelCase form (`"faStar"`) still validates and is read as `star`.

## Profile views: `/api/users/:id/visitors`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/users/:id/visitors` | Public | Recent named visitors (`limit`, up to 24) plus the total view count. Note the param is a user **id**, unlike `GET /users/:username`, which the profile page calls first. |

The view itself is **recorded** by `GET /users/:username`: a write inside a read, and not
awaited. We skip self-views, guests increase the counter without writing a row, and a
Redis window keeps a reload from hitting Postgres again. It swallows its own errors,
because recording who looked must never break the page they're looking at.

## Moderation: `/api/moderation`

Each route needs its own `moderation.*` permission.

Review cases (`/cases*`) come from core's `security-analysis` job: four built-in abuse
patterns (rapid logins, multi-accounts, registration bursts, ban evasion). They're
informational only, and each pattern can be switched off with its `security.pattern.*`
setting. Plugins can add their own scans or replace a built-in pattern through the SDK.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/reports` | Auth | File a report (any target type). |
| GET | `/summary` | Auth | Counts for the ModCanvas badges. |
| GET | `/reports` | Perm:`moderation.report.manage` | The report queue. |
| PATCH | `/reports/:id` | Perm:`moderation.report.manage` | Update a report's status. |
| GET | `/warnings` · POST `/warnings` | Perm:`moderation.warn` | List / issue warnings. |
| PATCH | `/warnings/:id/pardon` | Perm:`moderation.warn` | Pardon. |
| GET | `/bans` · POST `/bans` | Perm:`moderation.ban` | List / issue bans. |
| PATCH | `/bans/:id/lift` | Perm:`moderation.ban` | Lift a ban. |
| GET | `/cases` | Perm:`moderation.cases.manage` | Review cases. |
| PATCH | `/cases/:id` · POST `/cases/:id/ban-all` | Perm:`moderation.cases.manage` | Update / ban everyone in a case. |
| GET | `/log` | Perm:`moderation.log.view` | Moderation log. |
| DELETE | `/comments/article/:id` · `/comments/profile/:id` | Perm:`moderation.*` | Soft-delete with a reason (leaves a tombstone). |

## Appearance: `/api/appearance`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/css` | Public | The compiled token CSS the site loads, by scope (see below). `?source=draft` renders the draft instead (for the Style Editor's preview, never cached); `?theme=<id>` renders one installed theme for a reader who picked it. |
| GET | `/tokens` | Admin | `{ tokens, theme, installedTheme }`: the admin's layer and the theme's layer, **kept apart**. |
| PUT | `/tokens` | Admin | Save the admin's tokens (`{ tokens, label? }`, a map by scope). Goes into the **draft**. |
| PATCH | `/tokens/scope/:scope` | Admin | Merge ONE scope into the draft: `{ tokens: { "--x": "#fff" \| null } }`, where `null` clears a token. Returns the whole set. This exists for a second editor on the same draft (the Layout Editor's variant panel), because two screens both reading and writing the whole set would lose whichever edit landed first. |
| GET / PUT | `/custom-css` | Admin | The admin's own stylesheet. |
| GET | `/draft-status` | Admin | Whether there's an unpublished draft. |
| POST | `/publish` | Admin | Publish the draft now. |
| POST | `/reset` | Admin | *Reset appearance*: clears the admin's tokens and stylesheet and keeps the installed theme. |
| GET | `/version` | Public | The style version and poll interval, for live updates. |
| GET | `/stream` | Public | The same as a Server-Sent Events stream. |
| POST | `/history/:id/restore` | Admin | Restore a snapshot from the style history. |
| GET | `/branding` | Public | Resolved logo URLs and the site name. |
| POST | `/branding/:variant` (`multipart`) · DELETE `/branding/:variant` | Admin | Upload / reset a logo (`variant` is `navbar` or `icon`). |
| PUT | `/branding/text` | Admin | Show or hide the site name next to the logo. |
| PUT | `/branding/icon-kit` | Admin | Set or clear the site's **FontAwesome kit** (`{ kit }`: a kit id or its full URL; empty clears it). It has its own endpoint rather than the generic settings PUT because the value becomes a `<script src>` on every page, so the host is on an allowlist and we rebuild the URL instead of storing what was typed. |
| PUT | `/branding/icon-style` | Admin | Set the site-wide icon style (`{ style }`, e.g. `duotone-solid`). Checked against the shared list, because a style the app can't turn into classes would blank every icon. `solid` is the only style that works without a kit. |

`GET /branding` also returns `iconKitUrl` (validated again on the way out, since a settings
row can come from a restored backup) and `iconStyle` (turned into `solid` if we don't know
it, since a class nothing defines blanks every icon on the page). See
[Icons and FontAwesome Pro](icon-kits.md).

### Theming tokens & scoped CSS

Every visual value is a CSS custom property resolved in the browser. There are three
tiers, defined in `apps/web/src/styles/tokens.scss`, and described for code in
`TOKEN_REGISTRY` (`@xentium/contracts`):

| Tier | Prefix | Examples |
|---|---|---|
| Semantic (the palette) | `--c-*` | `--c-bg`, `--c-accent`, `--c-fg`, `--c-card` |
| Region | `--<region>-*` | `--nav-bg`, `--footer-bg`, `--content-bg`, `--aside-bg` |
| Component | `--<component>-*` | `--btn-bg`, `--card-bg`, `--input-bg`, `--menu-bg` |

- **Inheritance:** region and component tokens default to a semantic token
  (`--nav-bg: var(--c-surface)`), so changing the palette changes everything. You only
  override a token when that surface needs to be different. Tokens cover everything: fill,
  border (and each side), radius, shadow.
- **Scopes:** `GET /css` emits overrides by scope. `global` goes on the site root
  (`:root, .xt-site-tokens`), and a region's scope goes under that region's selector
  (`:root .pub-nav { … }`). Because custom properties inherit down the DOM, a region can
  change a component token (e.g. `.pub-nav { --btn-bg }` restyles only the navbar's
  buttons) without needing separate token names per region.
- **Style variants:** a scope can also be a named *look* instead of a place:
  `variant.surface`, `variant.muted`, `variant.accent` and `variant.plain`, emitted under
  `:root .xt-v--<name>`. The renderer puts that class on any block whose document says
  `"variant": "accent"`. `section` paints with the `--surface-*` tokens, and every variant
  points `--card-bg` and friends at them too, so one background token changes both kinds
  of surface.
- **Storage:** `PUT /tokens` takes one map by scope (`{ global: {…}, navbar: {…} }`). Token
  names must match `--[\w-]+`, and values can't contain `{ } < > ;`, because we write them
  into the stylesheet as they are. A scope this version doesn't know is **skipped**, never
  moved up to the site root.
- **Adding a token:** add a `TokenDef` to `TOKEN_REGISTRY` and define it in `tokens.scss`
  with a default from its semantic base. Don't hardcode values. See
  [CONTRIBUTING → Theming tokens](../CONTRIBUTING.md#theming-tokens).

How the layers, themes and this stylesheet fit together is in
[The style system](style-system.md).

## Public nav

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/nav-items` | Public | Active nav items by position (the browser filters by visibility). |

## Who's online

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/online` | Public | Users online right now, grouped by group. |

## Layouts: `/api/layouts`

The published page structure. It's public: layouts are the same for everyone, and every
block gets its data from endpoints that do their own permission checks.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/layouts` | Public | Every template's **published** `LayoutDocument`, by `TemplateKey`. A template with nothing stored returns the built-in default, so every key is always there. Cached in memory for 30 s; publishing clears it. `?theme=<id>` returns an installed theme's layouts for a reader who picked it. |

A `LayoutDocument` is `{ templateKey, schemaVersion, regions: { [region]: BlockNode[] } }`,
and a `BlockNode` is `{ id, type, props, children? }`. An unknown `type` isn't an error: the
renderer skips it and it stays in the document.

## Plugin management: `/api/plugins`

All **Admin**.

| Method | Path | Description |
|---|---|---|
| GET | `/` | Installed plugins and their status. |
| POST | `/validate` | Check an uploaded `.xtplugin` without installing it (`multipart`, field `file`). |
| POST | `/upload` | Install (rate-limited; `multipart`). |
| POST | `/:id/enable` | Enable (licensed plugins need an entitlement). |
| POST | `/:id/disable` | Disable (the data stays). |
| DELETE | `/:id?removeData=` | Uninstall (optionally reversing the migrations). |

## Plugin routes

| Method | Path | Auth | Description |
|---|---|---|---|
| * | `/api/p/:pluginId/*` | up to the plugin | Routes registered by an enabled plugin. While the plugin is disabled, a guard answers `404 XEC-PLUGIN-2020`. |

A plugin's **admin** endpoints under this prefix back its ACP settings pages, and those
pages **autosave**. So expect one debounced write per edit, not one submit from a Save
button. Make them idempotent writes of the whole object, check `admin.access` yourself
(the `/api/p/` prefix doesn't do that for you), and never autosave secrets: give a
write-only field its own Set/Remove route. The web side is described in
[Plugin pages in the ACP](plugin-acp-autosave.md).

---

## Admin (ACP): `/api/admin`

Everything below needs **Admin** (`admin.access`) unless a stricter permission is listed.

### Dashboard and users

| Method | Path | Description |
|---|---|---|
| GET | `/dashboard` | ACP dashboard stats. |
| GET | `/users` · `/users/:id` | User list / detail (including private fields, for admins and super moderators). |
| PUT | `/users/:id/groups` | Set group membership. |
| PATCH | `/users/:id/active` | Activate / deactivate. |
| POST | `/users/:id/ban` · DELETE `/users/:id/ban` | Ban / lift. |
| POST | `/users/:id/force-logout` | Revoke every session. |
| POST | `/users/:id/password-reset` | Send a reset email. |

### Profile fields

| Method | Path | Description |
|---|---|---|
| GET | `/profile-fields` | The field definitions. |
| POST · PATCH `/:id` · DELETE `/:id` | Create / update / delete (system fields can't be deleted). |
| PUT | `/profile-fields/reorder` | Reorder. |

### Access control

| Method | Path | Description |
|---|---|---|
| GET·POST·PATCH·DELETE | `/groups` · `/groups/:id` | Groups; plus `PUT /groups/reorder` (badge precedence), `PUT /groups/:id/permissions` (replace the whole set), `PATCH /groups/:id/permissions` (`{ grant, revoke }`: change only those keys, which is what the ACP uses so it never reverts a grant made elsewhere), `POST /groups/:id/icon` (`multipart`) and `DELETE /groups/:id/icon`. |
| GET | `/permissions` | Every permission, including the ones plugins registered. |
| GET·PATCH | `/progression` · `/progression/:id` | The ladder and per-group progression; plus `/progression/groups`, `PATCH /progression/settings`, `PATCH /progression/reorder`. |

### Content and moderation (ACP views)

| Method | Path | Description |
|---|---|---|
| GET | `/articles` · DELETE `/articles/:id` | Article list / delete. |
| GET | `/reports` · PATCH `/reports/:id` | The report queue. |
| GET | `/warnings` · POST · PATCH `/warnings/:id/pardon` | Warnings. |
| GET | `/bans` | Bans. |
| GET | `/cases` · PATCH `/cases/:id` · PATCH `/cases/:id/notes` · POST `/cases/:id/ban-all` · POST `/cases/:id/revoke-exception` | Review cases. |
| GET | `/modlog` | Moderation log. |
| DELETE | `/comments/article/:id` · `/comments/profile/:id` | Moderator soft-delete. |

### Extensions and licensing

A connected marketplace account is the only way to activate a licence. We removed manual
key entry from both the ACP and the API on 2026-07-18, so there's no
`POST /license/activate`. What the instance sends to the marketplace is described in
[the marketplace protocol](./marketplace-protocol.md).

| Method | Path | Description |
|---|---|---|
| GET | `/installed-plugins` | Installed plugins (ACP view). |
| GET | `/license` | The active licence row, or `null`. Includes the stored `entitlementJwt`. |
| POST | `/license/refresh` | Activate again from the connected account and re-verify. Fixes an install that connected before buying. |
| DELETE | `/license` | Deactivate locally. It doesn't free the seat; `DELETE /marketplace/connection` does that. |
| GET | `/marketplace/plugins` | The marketplace catalogue. **Paginated by the marketplace** (`page`/`limit`). An empty `data` means it's unreachable or not connected; we never make up a catalogue. Listings include `owned` when an account is connected. |
| GET·POST·DELETE | `/marketplace/connection` | Connection state / connect (`{authCode}`) / disconnect. GET also returns `accountUrl` and `licencesUrl`, so the ACP links to the marketplace it's actually using instead of guessing the default. Connecting creates this install's signing keypair; disconnecting frees the seats and drops every local credential. |
| POST | `/marketplace/link` | Start the **one-click handshake** → `{linkId, userCode, approveUrl, expiresAt, pollInterval}`. The admin opens `approveUrl` and checks that `userCode` matches the approval screen. The poll secret stays on the server and never reaches the browser. |
| GET | `/marketplace/link/:linkId` | Poll it → `{status: pending\|approved\|denied\|expired}`, plus `licenseActivated` once approved. `pending` is a **200**, not an error; it's the normal answer while someone is still deciding. |
| GET | `/marketplace/owned` | **What this account owns**, matched against what's installed here: `{licenses: [{keyRef, status, seats, seatsUsed, activeHere, updatesUntil, purchasedAt, product, installedVersion, installedStatus, updateAvailable}]}`. Not cached, because an admin opening this has usually just bought something. Different from the entitlement JWT, which lists *grants*, not licences. |
| GET | `/marketplace/updates` | The cached update check, matched against what's installed right now, plus `acknowledged` per admin. |
| POST | `/marketplace/authorize` | The download check → `AuthorizedDownload` (rate-limited). |
| POST | `/marketplace/install` · `/marketplace/update` | Install / update a plugin or theme. These **stream ndjson progress** instead of returning one JSON response. For a theme, the final event carries `activated` and `current` (see *Themes* below). |
| GET | `/status-summary` | The ACP badge signals in one place (pending updates, licence expiry, per-admin acknowledgement). |
| GET | `/registered-pages` | ACP pages registered by plugins (drives the ACP nav). |

### Layouts

Needs `admin.access`, like the rest of Appearance. `acpActivityLogger` records every
change.

| Method | Path | Description |
|---|---|---|
| GET | `/layouts` | Every template as the **draft** would render it (draft, else published, else default). The editor's preview iframe uses this. |
| GET | `/layouts/templates` | The template catalogue: each `key` with its `regions`, `label`, `pluginId`, `previewRoute`, `supportsVariants` and inheritance state. Built from the runtime registry, so an enabled plugin's templates are there and a disabled one's aren't. |
| GET | `/layouts/draft-status` | `{ pending: [...] }`: templates whose draft differs from what's live. |
| GET | `/layouts/:templateKey` | One template's draft, falling back to published, then to the default. |
| PUT | `/layouts/:templateKey` | Save the draft (`{ document }`). Refuses (422) an unknown region, a mismatched template key, a document missing a **required** block, or a template nothing has registered (a plugin template needs its plugin enabled). |
| POST | `/layouts/publish` | Publish **every** pending draft and clear them. Bumps the style version, so open tabs refresh over SSE. |
| POST | `/layouts/:templateKey/discard` | Throw away the draft and keep what's live. |
| POST | `/layouts/:templateKey/reset` | Delete the draft **and** the published version, going back to the built-in default. The theme's baseline is kept. |
| POST | `/layouts/:templateKey/revert-theme` | Put the installed theme's version of this template into the draft. 404 if no theme ships it. |

### Themes

| Method | Path | Description |
|---|---|---|
| POST | `/themes/import` | Install a `.xttheme` (`multipart`, field `file`). We validate everything first; one bad layout, asset or stylesheet means nothing is written. A **new** theme is added to the library **inactive**, and the site doesn't change. Only an update to the theme the site is wearing is applied right away. Returns `{ manifest, activated, current, templates, unknownTemplates, kept, replaced, tokensApplied, customCssApplied, assetsImported, unknownBlocks, ignoredFiles }`. |
| GET | `/themes/library` | Every installed theme, the active one first. |
| POST | `/themes/library/:id/activate` | Switch to an installed theme. **Live**, no publish step, and it records an undo point first. |
| DELETE | `/themes/library/:id` | Remove a theme from the library. The active theme can't be removed; switch first. |
| POST | `/themes/discard` | Undo the last import or switch. It only goes back one step. |
| GET | `/themes/installed` | The active theme's manifest and the templates its baseline covers. |
| POST | `/themes/export` | Build a `.xttheme` from what's **published**: layouts, tokens, custom CSS and every image they reference, with paths made package-relative. `multipart` body: `id, name, version, vendor, appearance`, plus optional `description, license, homepage, authorUrl, tokensOnly` and a `screenshot` file. Responds with `application/zip`. |

When `activated` is `false`, the site wasn't touched: `templates`, `kept` and `replaced` are
empty, and `current` is the theme the site is still wearing (`null` means stock Xentium).
The ACP then asks the admin whether to switch.

`unknownBlocks` is for your information, not a failure: those blocks stay in the document
and render once the plugin that provides them is enabled. `unknownTemplates` is the same
idea one level up: layouts in the package for templates this install doesn't know (a
plugin's template whose plugin isn't enabled). We skip those, since there are no declared
regions to check them against, and the rest of the theme still applies. `ignoredFiles`
lists parts of an older package we can't use, like its dark palette.

**Inheritance:** a theme is a layer *under* the admin's own changes. Its tokens go into the
theme layer and are merged under the admin's, so an update keeps every token the admin
set. Layouts work per template: the ones in `templates` were applied, the ones in `kept`
had been customized and were left alone (with the new baseline recorded), and you can
still get the theme's version with `POST /layouts/:templateKey/revert-theme`. The full rules
are in [the theme package format](theme-packages.md).

Assets unpack to `uploads/themes/<manifest id>/`, checked by magic bytes and limited (100
files, 5 MB each, 40 MB total).

### System

| Method | Path | Description |
|---|---|---|
| GET | `/settings` · `/settings/:key` · PUT `/settings/:key` | Platform settings. |
| GET | `/error-log` · DELETE `/error-log` | The error log (filterable) / clear it. |
| GET·PATCH | `/auth-providers` · `/auth-providers/:provider` | Sign-in provider settings (client id, secret, on/off). The secret is write-only: send `null` to remove it. |
| GET | `/migration-history` | `{ runs, schema }`: the last 100 runs (schema deploys and platform imports, a running import's live `progress` included) and the schema as it is now, the migrations this build ships against what the database has applied. |
| GET | `/style-history` | Style snapshots. |
| GET | `/xec-codes` | The XEC code list (for the Error Reference page). |
| GET·POST·PATCH·DELETE | `/nav-items` … `/nav-items/reorder` | The site's nav manager. |

### Beta and invites

For sites that are open only to invited users while in beta.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/beta/status` | Optional | The beta gate's state for the current visitor. |
| POST | `/api/beta/redeem` · `/api/beta/log-visit` | Public/Optional | Redeem a beta code / log a visit. |
| GET·POST·DELETE | `/api/admin/beta-codes` (+ `/log`) | Admin | Manage beta codes; the visit log. |
| GET·POST·DELETE | `/api/admin/invites` | Admin | Manage invites. |

---

## Good to know

- Things you do to your own account live under **`/api/account`**, not `/api/users/me/*`.
- Groups, permissions and progression are under **`/api/admin`**, not at the top level
  (`/api/groups` etc.).
- Licensing is under **`/api/admin/license`** and `/api/admin/marketplace`; there's no
  `/api/licenses`. What the instance itself sends to the marketplace is a separate
  contract, described in [the marketplace protocol](./marketplace-protocol.md).
- There's **no machine-readable OpenAPI spec** yet, so this page is the v1 contract. We'd
  like to generate OpenAPI from the routes and their Zod schemas after v1.

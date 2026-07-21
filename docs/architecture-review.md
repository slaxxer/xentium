# Architecture Review — Repeating Patterns, Bottlenecks, Reuse Opportunities

> Snapshot: 2026-07-11, branch `development` (post-PR #32, Phase 17 Hardening).
> Scope: core only (`apps/api`, `apps/web`, `packages`). Plugins not audited.
> Each item: **evidence → suggestion**. Priorities at the bottom.
>
> **⚠ 2026-07-21 addendum at the end of this file** (post-PR #34–#59 re-audit:
> what stayed fixed, what's still open, what's NEW). Read §A before starting work.

---

## 1. API — repeating patterns

### 1.1 `wrap()` async-handler is copy-pasted — and unnecessary on Express 5

The identical local helper appears in **7 controllers** (pages, users, installer,
articles, article-categories, account, comments):

```ts
const wrap = (fn: RequestHandler): RequestHandler => async (req, res, next) => {
  try { await fn(req, res, next); } catch (err) { next(err); }
};
```

Express **5** forwards rejected promises from async handlers to the error
middleware natively — this wrapper is Express-4 muscle memory.

**Suggestion:** delete all 7 copies and pass the async handlers directly. If a
belt-and-braces wrapper is still wanted, keep exactly one in
`shared/http/wrap.ts` — never per-module.

### 1.2 `AuthedRequest` / `reqUserId()` cast shim in 11 controllers

Every authed controller re-declares its own interface + cast helper because
`requireAuth` writes `(req as any).userId` without type augmentation
(`shared/middleware/requireAuth.ts:12`).

**Suggestion:** one ambient declaration, e.g. `apps/api/src/types/express.d.ts`:

```ts
declare global {
  namespace Express {
    interface Request { userId?: string; sessionId?: string }
  }
}
```

Then `req.userId` typechecks everywhere; delete all 11 shims and the `as any`
in `requireAuth`/`optionalAuth`. Bonus: same trick for multer's `detectedExt`
(see 1.6).

### 1.3 Pagination is hand-rolled two different ways

- `buildPaginationMeta` exists in `@nodevo/contracts` and is used by ~7 services.
- **18 other call sites** hand-roll `{ page, limit, total, totalPages: Math.ceil(total / limit) }`
  (all of `admin.service.ts` and `moderation.service.ts`) — these omit
  `hasPrev`/`hasNext`, so the two shapes are silently divergent.
- The surrounding query is the same everywhere:
  `Promise.all([model.findMany({ where, skip: (page-1)*limit, take: limit, orderBy, include }), model.count({ where })])`.

**Suggestion:** a single helper in `shared/utils/paginate.ts`:

```ts
export async function paginate<T>(
  delegate: { findMany: Fn; count: Fn },
  { where, orderBy, include, select, page, limit }: PaginateArgs,
): Promise<PaginatedResponse<T>> {
  const [data, total] = await Promise.all([
    delegate.findMany({ where, orderBy, include, select, skip: (page - 1) * limit, take: limit }),
    delegate.count({ where }),
  ]);
  return { data, meta: buildPaginationMeta({ page, limit, total }) };
}
```

Collapses ~15 list methods to one line each and makes `buildPaginationMeta` the
only meta producer. (Plugins can get the same helper via `@nodevo/sdk` later —
forum/messaging paginate too.)

### 1.4 The "user reference" DTO is assembled by hand ~37 times

`badgeColorSelect` + `extractBadgeColor` mapping (`{ id, username, badgeColor }`)
appears **28× in `admin.service.ts`** and **9× re-implemented inline in
`moderation.service.ts`** (which re-declares its own `badgeColorSelect` inside
methods, e.g. `moderation.service.ts:582`).

**Suggestion:** promote to a shared module (e.g. `shared/utils/userRef.ts` or
exported from `modules/users`):

```ts
export const USER_REF_SELECT = { id: true, username: true, groups: { include: { group: { select: { progression: { select: { badgeColor: true } } } } } } };
export function toUserRef(u): UserRef { return { id: u.id, username: u.username, badgeColor: u.groups[0]?.group.progression?.badgeColor ?? null }; }
```

One select shape, one mapper, one `UserRef` type in contracts (the web already
consumes this shape in ModCanvas/ACP — it deserves a name).

### 1.5 `admin.service.ts` (1,144 lines) is a grab-bag that duplicates other modules

It owns: dashboard, user admin, profile fields, settings, article admin, health,
**reports/warnings/bans/cases/mod-log**, plugins, license, error log, migration
history, style history, nav items. The moderation methods are near-1:1 copies of
`moderation.service.ts` (`listReports` vs `listReportsCanvas`, `listWarnings` vs
`listWarningsCanvas`, `updateReport`, `issueWarning`, `pardonWarning`,
`updateCase` exist in both — same queries, same mapping, different filters).

**Suggestion:**
- Admin should **orchestrate, not own**: `admin.controller` for moderation
  routes should call `moderationService` with an options bag
  (`{ status?, scope: "acp" | "canvas" }`) instead of a parallel implementation.
- Split the rest of `admin.service.ts` along domain seams (dashboard/health,
  user-admin, nav, system-logs). Even simple file splits
  (`admin/users.service.ts`, `admin/system.service.ts`) restore navigability.
- Rule of thumb going forward: *if a domain module exists, the ACP variant of a
  query lives there, parameterized — never re-implemented under `admin/`.*

### 1.6 Upload handling duplicated across 5 controllers

The `detectedExt` cast + `storage.save(...)` + `publicUrl` dance repeats in
pages (×2), articles, account, groups, appearance with small variants.

**Suggestion:** `storage.saveUpload(file, dir, nameFn)` on the StorageProvider
(returns `{ relPath, url }`), plus a module augmentation typing `detectedExt`
on `Express.Multer.File` so the casts disappear.

### 1.7 Two error conventions live side by side (known gotcha — now measurable)

- 109 sites throw `NodevoError` → nested `{ error: { code, message, … } }` via
  errorMiddleware. ✅ the documented convention.
- `auth.controller.ts` alone uses `safeParse` + flat string errors that are
  **not even NEC codes**: `invalid_input`, `invalid_credentials`,
  `account_banned`, `no_session`, `session_expired`, `user_not_found`.

The frontend must know both shapes (`err.detail.error?.code` vs
`err.detail.error`), which has already caused bugs.

**Suggestion:** pre-alpha is the last cheap moment to unify. Migrate auth to
thrown `NodevoError` with NEC-AUTH codes; delete the dual-shape handling in
`apps/web/src/lib/api.ts`. If any flat code is load-bearing for the SPA
(banned payload), carry it in `details`.

### 1.8 Repository layer is aspirational, not enforced

CLAUDE.md prescribes `routes → controller → service → repository`, but:
admin, moderation, site, account, progression have **no repository at all**, and
even modules *with* repositories (pages, users, articles, groups) import
`prisma` directly in services. The `deletedAt: null` soft-delete default
(claimed to live in repos) appears inline only 13× — most queries rely on the
table not having soft delete.

**Suggestion:** pick one story and write it down:
- **(a) Drop the repository layer as a requirement** — "services may use prisma
  directly; extract a repository only when a query is shared or complex." This
  matches reality and costs nothing. *(Recommended for a modular monolith of
  this size.)*
- (b) Enforce it — ESLint `no-restricted-imports` banning
  `infrastructure/db` outside `*.repository.ts`. Significant churn.

Either way, update CLAUDE.md so the convention and codebase agree.

### 1.9 `readSetting` is a verbatim clone of `getSetting`

`appearance.service.ts:120` re-implements `shared/utils/settings.ts` exactly.
Delete it; import the shared one (or the cached service from §2.1).

---

## 2. API — bottlenecks

### 2.1 Settings reads: 1 uncached DB query per key, on hot paths ⚠ biggest win

`getSetting()` = `prisma.setting.findUnique` per call, no caching, 40+ call sites.
Consequences:

| Hot path | Cost |
|---|---|
| `maintenanceGuard` | **+1 DB query on every `/api` request** (`maintenance.enabled`) |
| `siteService.getConfig` (SPA boot, maintenance-exempt) | 8 settings queries + navItems |
| `maintenanceService.getStatus` | 7–8 queries |
| `appearance /version` poll (legacy path) | 2 queries per poll per client |
| `siteService.getFooter` | 1 query (`site.name`) per render + cached stats |

**Suggestion:** one cached settings service in `shared/`:
- `getSettings(keys[])` → single `findMany({ where: { key: { in } } })` batch.
- In-memory cache (30–60s TTL is plenty; settings change via ACP rarely) with
  **explicit bust in `admin.setSetting`**. For the api/worker split, either let
  the worker live with the TTL or publish a Redis `settings:changed` bust —
  worker barely reads settings, TTL alone is fine.
- `maintenanceGuard` then costs zero DB queries in steady state, and
  `getConfig`/`getStatus` become one query or pure cache hits.

This single change removes the per-request DB tax on **every** endpoint.

### 2.2 `installGuard` re-queries per request in dev

Intentional (`!isDev` cache skip) — fine, but worth a comment that prod is
cached so nobody "fixes" it. No action.

### 2.3 `/appearance/css` rebuilds per request

`buildCSS(tokens)` runs on every fetch; `max-age=60` softens it. Since every
publish bumps `appearance.style_version`, memoize the built CSS keyed on
version (invalidate on bump). Combined with SSE, steady state becomes zero work.

### 2.4 `/appearance/version` legacy poll path

SSE (`/stream`) is live and the web client uses it; the poll endpoint still
costs 2 settings queries per hit for any old/other clients. Once §2.1 lands
this is cached anyway — otherwise consider retiring the endpoint in v1 (nothing
external depends on it pre-release).

### 2.5 `admin.listReports` N+1 + stats fan-out

Per-report target resolution runs one `findUnique` per row inside
`Promise.all`, plus 3 separate `count` queries per page load
(`admin.service.ts:751–784`). Fine at ACP scale; if consolidating with
moderation (§1.5), batch targets by type (`findMany({ id: { in } })` per
targetType) and merge the counts into one `groupBy`.

### 2.6 Anti-pattern about to spread: hand-rolled TTL memos

`footerStatsCache` in `site.service.ts:79` is a good idea implemented as a
one-off (`let cache; if (Date.now() - at < TTL) …`). The CSS memo (§2.3) and
settings cache (§2.1) will each want the same thing.

**Suggestion:** a tiny `memoTtl(fn, ms)` / `TtlCache<K,V>` in `shared/utils` so
every in-process cache has one shape (and one place to add stats/bust hooks).

### Already good (keep as the reference patterns)
- Permission cache: Redis, 5-min TTL, keyed `perm:user:{id}` ✅
- SSE for style sync (zero steady-state requests) ✅
- Footer stat aggregation cached 30s ✅ (just generalize the memo)
- `normalizeIp`, `rkey()` discipline, Zod-at-the-edge ✅

---

## 3. Web — repeating patterns

### 3.1 `timeAgo` implemented 9 times — and it's an i18n bug

Copies in DashboardPage, GuestHome, ModLogPage, ErrorLogPage, ModCanvas,
UsersSection, HomePage, NotificationBell, SearchPage. Four of them return
hardcoded English (`"just now"`, `"5m ago"`) — invisible to the i18n
externalization effort.

**Suggestion:** `lib/time.ts` with one `timeAgo(iso, t)` (or
`Intl.RelativeTimeFormat`, which localizes for free and needs no keys). Delete
the 9 copies. This is also a host-global candidate so plugins stop growing
their own.

### 3.2 `Badge` copy-pasted 4× with identical inline styles

ErrorLogPage, ErrorReferencePage, ModLogPage, InstalledPage all define the same
`function Badge({ label, color })` with inline
`padding:"3px 10px", borderRadius:100, fontSize:11` — violating the
"no hardcoded visual values" rule 4×.

**Suggestion:** `components/Badge.tsx` + SCSS with tokens. Same sweep should
catch the repeated inline pagination-bar styles (§3.3).

### 3.3 Pagination UI re-implemented per page

`acp-pagination` markup + the same inline style object
(`padding:"12px 20px", borderTop:"1px solid var(--c-border)"`) duplicated in
PagesPage, ArticlesPage, ActivityLogPage; MembersPage has its own
`mp-pagination`; UserListPage, ErrorLogPage, SettingsPage roll their own
prev/next state.

**Suggestion:** one `<Pager meta={meta} onPage={setPage} />` in
`components/` (or `packages/ui` if plugins should reuse it), styles in SCSS.
Pairs naturally with a `useAcpList` hook (page/filter state + queryKey +
`URLSearchParams` building), which is the same 20 lines in ~10 ACP pages.

### 3.4 API surface is 90% inline `api.get(...)` strings in components

209 raw `api.*` calls live inside feature components; only `pagesApi` /
`articlesApi` exist as typed modules. Each page re-declares its own response
interfaces (e.g. `ErrorLogPage`'s local `meta: { page; limit; total; totalPages }`)
even though `PaginatedResponse<T>` already exists in `@nodevo/contracts`.

**Suggestion:** don't boil the ocean — adopt two rules for new/touched code:
1. Feature-level `api.ts` per slice (the endpoints + types), components import
   functions, not URL strings.
2. Web imports `PaginatedResponse` from contracts instead of re-typing `meta`.

### 3.5 Query keys are ad-hoc string literals

`["acp-settings"]` is spelled in 6 places, `["profile", username]` vs
`["profile", user?.username]`, etc. Works, but invalidation typos are silent.

**Suggestion:** a small `lib/queryKeys.ts` registry
(`qk.acpSettings`, `qk.profile(username)`) — cheap now, painful later.

### 3.6 Monolithic pages

`GroupsPage.tsx` 1,152 lines / **25 `useState`**, `SettingsPage.tsx` 1,031,
`StyleEditorPage.tsx` 948, `InstallerWizard.tsx` 928 (17 useState). These are
where regressions will hide during Hardening.

**Suggestion:** no rewrite — just extract each logical card/tab into a child
component with a `useReducer` or grouped state object when next touched
(GroupsPage's create/edit form is the obvious first cut; it just absorbed the
badge-glow editor).

---

## 4. Guardrails to keep the core clean

1. **Lint the conventions you already have** (they're prose today):
   - `no-restricted-imports`: `infrastructure/db` outside services/repos
     (per §1.8 decision); `../../../lib/api` inside `features/*` components once
     feature api modules exist (warn-level).
   - `no-restricted-syntax`: new `function timeAgo` / local `Badge`
     declarations outside `lib/`/`components/`.
2. **DB naming validator** (`ncf_`/plugin prefix) — already on the TODO list;
   a unit test over the Prisma DMMF + `nodevo_plugin_migrations` DDL is enough.
3. **Decide the repository question (§1.8) and update CLAUDE.md** — a stated
   convention the code contradicts is worse than no convention.
4. **"ACP variants live in the domain module"** rule (§1.5) — this is the one
   that prevents the next `admin.service.ts`.
5. **New shared helpers land in the right layer**: web-only → `apps/web/lib`;
   API-only → `apps/api/shared`; plugin-reusable → `@nodevo/sdk` /
   `@nodevo/ui`; type/shape → `@nodevo/contracts`. Worth a one-liner in
   CLAUDE.md so helpers stop being born inside feature files.

---

## 5. Priorities

| # | Item | Impact | Effort | Status |
|---|---|---|---|---|
| 1 | Cached/batched settings service (§2.1) — kills the per-request DB query | High | S | ✅ done 2026-07-11 |
| 2 | Express type augmentation + delete `wrap()`s (§1.1/1.2) | Med | S | ✅ done 2026-07-11 |
| 3 | Unify auth error shape onto NEC/NodevoError (§1.7) | High (pre-release only gets harder) | M | open → A5.1 (worsened) |
| 4 | `paginate()` helper + `buildPaginationMeta` everywhere (§1.3) | Med | S | ✅ done 2026-07-11 |
| 5 | `UserRef` select/mapper (§1.4) | Med | S | ✅ done 2026-07-11 |
| 6 | De-duplicate admin ⇄ moderation services (§1.5) | High (correctness drift risk) | M | open → A2 |
| 7 | Web: `timeAgo` + `Badge` + `Pager` extraction (§3.1–3.3) | Med (+ fixes i18n gaps) | S | open → A2 (grew to 10 copies) |
| 8 | `memoTtl` util + CSS memo (§2.3/2.6) | Low-Med | S | ✅ done 2026-07-11 |
| 9 | Repository-layer decision + CLAUDE.md update (§1.8) | Med (clarity) | XS | ✅ done 2026-07-11 (dropped as requirement) |
| 10 | Feature api modules / query-key registry (§3.4/3.5) | Med | ongoing rule, not a project | open → A5.4 |

Items 1, 2, 4, 5, 8, 9 landed 2026-07-11 (see LAST_CODEBASEUPDATE.md); the
installer's custom `wrap` was intentionally kept (it maps errors to flat JSON
before errorMiddleware/DB exist). Items 3 and 6 change behavior/contracts and
deserve their own PRs with runtime click-throughs.

---
---

# Addendum — 2026-07-21 re-audit (post-PR #34–#59)

> Snapshot: 2026-07-21, branch `development` at `a161268` (post marketplace epic,
> plugin-update pipeline #47–#52, ACP i18n #53–#59). Verified the 2026-07-11 fixes
> **stayed** fixed (settings cache, express typing, paginate, UserRef, memoTtl —
> all still in place and used by the new code). Below: what's still open from the
> original review, and what's NEW since. Evidence as `file:line` at audit time.

## A1. Bad architecture decisions

### A1.1 `admin.controller.ts` is becoming the next grab-bag — business logic in the controller layer (NEW)

`admin.controller.ts` is 817 lines; ~250 of them are marketplace/update *services*
living in a controller: `downloadAndVerifyArtifact` (:128), `fetchMarketplaceArtifact`
(:195), `semverCompare` (:210), `readReconciledUpdates` (:237), and the status-summary
assembly (:557–605). This is the exact `admin.service.ts` failure mode (§1.5)
repeating one layer up — the "admin orchestrates, doesn't own" rule got violated by
the newest code.

**Suggestion:** extract a `marketplace.service.ts` (or extend the license-engine)
owning download/verify, update reconciliation, and status aggregation. Controller
keeps only Zod parsing + the NDJSON stream plumbing.

### A1.2 Dialog acknowledgment state is stored in telemetry (NEW, subtle)

The per-admin update/license dialogs use `activityService.hasVisitedSince()` over
`ncf_activity_log` page-visit rows as their source of truth (admin.controller.ts:546,
:588). Durable UX state is coupled to an unbounded log table that *needs* a retention
job (A4.1). The moment retention lands, pruning silently un-acknowledges dialogs: an
update pending longer than the retention window (`setSince` months old) re-nudges
every admin forever.

**Suggestion:** acknowledgment wants its own tiny table (or per-admin meta key), not
log archaeology. **Design retention (A4.1) and acknowledgment storage together.**

### A1.3 Schema says many groups, the system assumes one

`UserGroup` is a full M2M (schema.prisma:197), `setUserGroups` accepts arrays, and
permission resolution correctly unions all groups (requirePermission.ts:13–31) — but
`userRef.ts` and 7 other sites read `groups[0]` **with no orderBy** to pick "the"
badge colour. For a user in 2+ groups, which badge/progression they get is
nondeterministic (Postgres row order). CLAUDE.md says "users belong to one group";
docs, schema, and code disagree three ways.

**Suggestion:** pick one — enforce single-group at the write path, or define a
primary-group ordering (e.g. `position` on `ncf_user_groups`) and use it everywhere
`groups[0]` appears today.

### A1.4 Paid plugin source is unversioned (still the single biggest project risk)

`plugins/official/` is git-ignored — revenue-critical source for 4 plugins exists
only in the working tree. Noted since 2026-07-11; keeps not happening. Each plugin
needs its own repo (or one private plugins monorepo) + backup.

### A1.5 Settings table as a KV blob store for marketplace state

`marketplace.updates`, `marketplace.paid_plugin_ids`, and the account token live as
JSON strings in `ncf_settings` — the token in plaintext (encryption-at-rest already
on the TODO). These are caches/credentials with different lifecycles than site
settings; every consumer re-parses JSON with ad-hoc shape checks
(`readReconciledUpdates` does its own defensive parse). Workable, but contain it:
one typed accessor module per blob, and encrypt the token.

## A2. Duplicated logic

- **Admin ⇄ moderation services — still duplicated** (original §1.5/item 6,
  unchanged): `admin.service.ts` (1,136 lines) still carries near-1:1 copies of
  `listReports`/`listWarnings`/`issueWarning`/`pardonWarning`/`updateReport`/
  `updateCase` alongside `moderation.service.ts` (953). Correctness-drift risk grows
  with every one-sided patch.
- **`semverCompare` exists twice** (NEW): admin.controller.ts:210 and
  plugin-engine.ts:135 — same hand-rolled function. Belongs in `shared/utils` (or
  `@nodevo/sdk` for plugin reuse).
- **`timeAgo` grew from 9 to 10 copies** (item 7, *worsening*): the two pages added
  since the audit (`ReviewCasesPage.tsx`, `CasesSection.tsx`) each grew their own
  copy — the missing `lib/time.ts` actively breeds duplicates. Several still
  hardcode English, undermining the just-finished ACP i18n pass.
- **`Badge` still copy-pasted in 6 files; no shared `Pager`** (item 7): neither
  landed in `components/`.
- **Auth verification implemented twice**: `requirePermission` inlines its own
  `verifyAccess` + Bearer parsing (requirePermission.ts:39–42) instead of composing
  with `requireAuth`.
- **`permissions.repository.ts` is an empty file** — dead artifact, delete it.

## A3. Performance bottlenecks

### A3.1 Dashboard analytics loads raw rows and buckets in JS

`getDashboardAnalytics` (admin.service.ts:128–150): for a 90-day range it
`findMany`s **every** user/comment/article/login-event/report row in a 180-day
window (span = 2×range) per dashboard view, just to count per day. `loginEvent`
alone reaches tens of thousands of rows on a modest site.

**Suggestion:** one `GROUP BY date_trunc('day', …)` raw query per series —
constant-size result regardless of traffic.

### A3.2 Smaller hits

- `getOneSetting` fetches ALL settings to return one (admin.controller.ts:373–378);
  `getSetting(key)` is one import away.
- `acpActivityLogger` fires an extra `user.findUnique` per logged mutation
  (acpActivityLogger.ts:20) just to denormalize the username. Cache it, or resolve
  username at read time.
- `hasVisitedSince` has no matching index: filters
  `{category, userId, path, createdAt ≥}` but `ActivityLog` only has
  `[category, createdAt]` + `[userId]` (schema.prisma:898–899). Runs up to 2× per
  status-summary call; degrades linearly with log growth (A4.1).
- `appearance.routes.ts` still wraps every route in try/catch — harmless, but
  inconsistent with the Express-5 `wrap()` cleanup done everywhere else.

## A4. Scalability risks

### A4.1 `ncf_activity_log` has NO retention job and now logs every ACP page view ⚠

PR #48 deliberately widened logging to all ACP navigations. The scheduled-jobs
registry has security/ban/warning/license/update/appearance jobs — **nothing prunes
activity_log, error_log, or login_events**. Unbounded growth on three tables, one of
which backs a hot ACP query and a UX feature. Must be designed together with A1.2.

### A4.2 `permissionCache.invalidateForGroup` doesn't scale

permission.cache.ts:21–29: editing the default members group's permissions on a site
with 100k users = `findMany` of 100k userIds + a single `redis.del(...100k keys)`.

**Suggestion:** a group-version stamp folded into the cache key (bump one key; old
entries lapse via TTL) removes the fan-out entirely.

### A4.3 Other

- **Offset pagination everywhere** (`skip: (page-1)*limit`): fine for ACP lists;
  public deep pages on large tables degrade. Worth a cursor option in `paginate()`
  before plugins copy the pattern at forum scale.
- **No concurrency guard on plugin update/install**: two admins clicking "update"
  simultaneously race the disable→swap→re-enable sequence in plugin-engine (no
  lock/in-progress flag). Low likelihood, filesystem-corrupting consequence — a
  per-plugin in-process (or Redis) mutex closes it.
- ✅ The in-process `TtlCache` story (settings 15s, memoTtl) is fine — documented TTL
  convergence — and SSE style-sync correctly uses Redis pub/sub for cross-process
  fan-out (appearance.sse.ts). Keep as reference patterns.

## A5. Maintainability issues

### A5.1 Error contract is now effectively THREE shapes (item 3, worsening)

- `auth.controller.ts` still returns flat non-NEC strings (`invalid_input`,
  `account_banned`, … lines 63–199).
- `requirePermission` adds flat `unauthenticated`/`forbidden`/`invalid_token`.
- NEW: the marketplace endpoints introduced a third shape — `ArtifactError` →
  `{message}` with raw 400/502 (admin.controller.ts:204, :684), no NEC codes.

Every new client surface must know all three. The original warning was "pre-alpha is
the last cheap moment" — that moment is closing.

### A5.2 62 `await import()` calls across the API, 24 in `admin.controller.ts` alone (NEW)

Used as a circular-dependency dodge; hides the real module graph, moves import
failures from boot time to request time, and makes refactors (like A1.1) harder
because dependencies are invisible to tooling. Extracting the marketplace service
kills half of them; the rest should become top-level imports unless a genuine cycle
is documented at the call site.

### A5.3 Monolithic web pages got bigger, not smaller

GroupsPage 1,160 (grew during i18n part 4), SettingsPage 1,031, StyleEditorPage 978,
InstallerWizard 928. The i18n passes touched all of them without decomposing — each
future touch pays the same tax. Original §3.6 advice stands: extract per card/tab
when next touched.

### A5.4 Query keys / feature api modules still ad-hoc (item 10)

e.g. `["acp-status-summary"]` is spelled in AcpStatusBadge.tsx:23 and
AcpLayout.tsx:87 with independently-declared queryFns and differing options.

## A6. Priorities (2026-07-21)

| # | Item | Impact | Effort | Notes |
|---|---|---|---|---|
| 1 | Retention jobs (activity/error/login logs) + move dialog-ack out of the activity log (A4.1 + A1.2) | High | M | Must ship together |
| 2 | Extract marketplace/update logic from admin.controller into a service (A1.1) | High | M | ✅ done 2026-07-21 — `modules/admin/marketplace.service.ts`; controller 817→543 lines, dynamic imports 24→0 |
| 3 | Unify the error contract — now 3 shapes (A5.1, original item 3) | High | M | Cost rises every release |
| 4 | Resolve group-model ambiguity — `groups[0]` nondeterminism (A1.3) | Med | S | Cheap now, support tickets later |
| 5 | Version-control `plugins/official/` (A1.4) | High | XS | One bad `rm -rf` from losing the revenue line |
| 6 | Dashboard analytics → SQL GROUP BY (A3.1) | Med | S | |
| 7 | Admin ⇄ moderation dedup (A2, original item 6) | High | M | Still the biggest drift risk |
| 8 | `timeAgo`/`Badge`/`Pager` extraction (A2, original item 7) | Med | S | Also fixes i18n gaps; count grew to 10 |
| 9 | `invalidateForGroup` version-stamp (A4.2) | Med | S | |
| 10 | Quick wins: `getOneSetting`, empty repository file, semver dedup, plugin-update mutex | Low-Med | XS-S | ✅ done 2026-07-21 (shared/utils/semver.ts, lifecycle lock in plugin.service.ts) |

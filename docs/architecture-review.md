# Architecture Review — Repeating Patterns, Bottlenecks, Reuse Opportunities

> Snapshot: 2026-07-11, branch `development` (post-PR #32, Phase 17 Hardening).
> Scope: core only (`apps/api`, `apps/web`, `packages`). Plugins not audited.
> Each item: **evidence → suggestion**. Priorities at the bottom.

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
| 3 | Unify auth error shape onto NEC/NodevoError (§1.7) | High (pre-release only gets harder) | M | open |
| 4 | `paginate()` helper + `buildPaginationMeta` everywhere (§1.3) | Med | S | ✅ done 2026-07-11 |
| 5 | `UserRef` select/mapper (§1.4) | Med | S | ✅ done 2026-07-11 |
| 6 | De-duplicate admin ⇄ moderation services (§1.5) | High (correctness drift risk) | M | open |
| 7 | Web: `timeAgo` + `Badge` + `Pager` extraction (§3.1–3.3) | Med (+ fixes i18n gaps) | S | open |
| 8 | `memoTtl` util + CSS memo (§2.3/2.6) | Low-Med | S | ✅ done 2026-07-11 |
| 9 | Repository-layer decision + CLAUDE.md update (§1.8) | Med (clarity) | XS | ✅ done 2026-07-11 (dropped as requirement) |
| 10 | Feature api modules / query-key registry (§3.4/3.5) | Med | ongoing rule, not a project | open |

Items 1, 2, 4, 5, 8, 9 landed 2026-07-11 (see LAST_CODEBASEUPDATE.md); the
installer's custom `wrap` was intentionally kept (it maps errors to flat JSON
before errorMiddleware/DB exist). Items 3 and 6 change behavior/contracts and
deserve their own PRs with runtime click-throughs.

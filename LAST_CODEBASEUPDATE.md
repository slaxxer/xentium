# Last Codebase Update — 2026-07-23

Four commits, one per audit item: `c6d26b2` error-shape unification (A6 #3),
`deebc3a` primary-group determinism + dashboard GROUP BY (A6 #4 + #6),
`e29f085` web timeAgo/Badge/Pager dedup (A6 #8), `eb02171` admin⇄moderation
list dedup (A6 #7). Also: test instance reconciled + restarted (API 4100,
web 5174, worker w/ log-retention job scheduled; acp_visits migration was
already applied). Remaining audit item: #5 version-control plugins/official
(needs a hosting decision).

## Batch 4 — admin ⇄ moderation list dedup (audit A2 / A6 #7)

- listReports/listWarnings/listBans moved to moderation.service as the ONE
  implementation; listWarningsCanvas/listBansCanvas = delegates with
  status:"active"; adminService delegates (bans with withStats:true for the
  ACP header counts). listReportsCanvas + admin listCases intentionally stay
  separate (genuinely different contracts). admin.service's four
  `await import("../moderation/…")` write-op delegates → one top-level import
  (verified no cycle). Runtime-verified: all 6 endpoints byte-identical shapes.

## Batch 3 — web timeAgo/Badge/Pager extraction (audit A2 / A6 #8)

- NEW `lib/time.ts` — localized timeAgo (full + compact styles, `time.*` keys
  in the common namespace ×5 langs); replaced 10 per-page copies (several
  hardcoded English). SearchPage's day-granularity variant intentionally kept.
- NEW `components/Badge.tsx` (4 ACP copies removed), `components/Pager.tsx`
  (4 inlined ACP pager blocks removed; label stays caller-localized).
- acp.json `dashboard.ago*` keys removed ×5 langs (superseded by common
  `time.*`).

## Batch 2 — primary-group determinism + dashboard GROUP BY (A6 #4 + #6)

- `userRef.ts` exports `primaryGroupOrder` ({group:{displayOrder:"asc"}});
  badgeColorSelect + every ad-hoc `groups[0]` query now orders by it
  (online.routes, users.repository ×2, comment.service, notification.service,
  admin.service case links, auth meHandler).
- `getDashboardAnalytics`: 5 findMany-all-rows series → one GROUP BY
  local-day `$queryRaw` each (`to_char((col AT TIME ZONE 'UTC') AT TIME ZONE
  <server tz>, 'YYYY-MM-DD')`). E2E old-vs-new comparison: ranges 7/30 exact
  match; range 90 differs ONLY where the old code was wrong (DST spring-forward
  crossing shifted buckets 1h → events near local midnight fell a day early).
  ⚠ Dev-DB note: vitest's installer test re-seeds the dev DB admin — root's
  user id changes after every `vitest run`.

## Batch 1 — error-shape unification (audit A5.1 / A6 #3) — the 3 API error shapes → 1

Everything now flows through NodevoError → errorMiddleware in the canonical
`{error:{code,message,details,severity}}` envelope. Runtime-verified via curl
against dev :4000 (see Verification).

### Contracts
- `packages/contracts/src/nec.ts` — new codes: `AUTH_UNAUTHENTICATED` 1008,
  `AUTH_TOKEN_INVALID` 1009, `AUTH_NO_SESSION` 1010; formalized the literals
  already in use (1020/1021/1030/1031/1032/1040/2004/2010); new
  `MARKETPLACE_NO_ARTIFACT/DOWNLOAD_FAILED/ARTIFACT_INVALID` 9101–9103.

### API
- `NodevoError` — new optional `persist` flag (default true); errorMiddleware
  skips the error_log write when false. Used for expected high-frequency 401s
  (guest refresh, token expiry, failed credentials) so error_log stays signal.
- `auth.controller.ts` — all flat strings gone. Zod `safeParse`+`invalid_input`
  (400) → `parse()` → 422 NEC-API-4001; invalid credentials → 1001
  (persist:false); banned → 1003/1004 with `details:{reason,expiresAt}`; beta
  gate → thrown coded 403; refresh → 1010/1002 (persist:false); me → 4004.
- `requireAuth.ts` / `requirePermission.ts` — throw NodevoErrors
  (1008/1009 persist:false; forbidden → NEC-PERM-1001 with
  `details:{required:[keys]}`, persisted). requireAuth exports
  `unauthenticatedError()`/`invalidTokenError()` for reuse. Side effect: a DB
  failure in loadEffective now 500s instead of masquerading as 401.
- `marketplace.service.ts` — `ArtifactError extends NodevoError` (keeps
  message + status, gains NEC code); the `err instanceof NodevoError` guard
  passes through intake NodevoErrors unwrapped.
- `admin.controller.ts` — installFromMarketplace's shape-mangling try/catch
  DELETED (it flattened e.g. 409 PLUGIN_ALREADY_INSTALLED to 400 `{message}`);
  errors propagate to errorMiddleware. NDJSON update stream unchanged
  (terminal events now carry marketplace codes).
- `search.routes.ts` — `invalid_query` → Zod parse (422 4001).
  `appearance.routes.ts` branding upload — flat strings → NodevoError
  (4001 / STORE_TYPE_NOT_PERMITTED).
- NOT touched (by design): installer/setup surface (`setupServer.ts`,
  `installGuard.ts`, `installer.controller.ts`) — pre-install lifecycle,
  self-removes, InstallerWizard depends on its literal keys.

### Web
- `lib/api.ts` — err.message extraction simplified to the canonical shape
  (string fallback kept only for the installer surface).
- `LoginPage.tsx` — banned branch reads 1003/1004 + `details`; 1001 for bad
  credentials; dual-shape comment gone.
- `BetaGatePage.tsx` / `ResetPasswordPage.tsx` / `RegisterPage.tsx` — read
  `detail.error.code`; fixes LATENT bugs where NEC comparisons ran against the
  nested object and always fell to generic messages (reset "expired" message,
  beta 1031/1032 dialogs, email/username-taken now code-based not
  message-sniffing; invalid-input status check 400 → code-based).
- `public/locales/{en,de,es,fr,pt}/errors.json` — +1008/1009/1010/2010.

### Docs
- `docs/architecture-review.md` — §5 item 3 + A6 #3 marked done; A5.1 carries
  the resolution note.

### Verification
- backbone equivalent green: typecheck 19/19, lint 10/10, API tests 21/21,
  build 14/14.
- Runtime (dev :4000, curl): wrong creds → 401 1001; bad body → 422 4001;
  no token → 401 1008; garbage token → 401 1009; no refresh cookie → 401 1010;
  group-less user on admin route → 403 PERM-1001 with `required:["admin.access"]`.
  error_log after the run: ONLY the Zod 4001 rows + the PERM-1001 row —
  persist:false confirmed for the 401 family. Test user + rows cleaned up.
- Browser click-through still recommended: login failure/banned/lockout toasts,
  a failed marketplace install, register duplicate-email path.

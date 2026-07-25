# Last Codebase Update — 2026-07-25 (security cluster)

Phase 17 hardening: the security/correctness cluster (BUGS.md #1/#4/#6 + audit
A1.5). Four fixes.

## #1 — Immediate session revocation (BUGS.md #4)

- NEW `modules/auth/session-revocation.ts` — Redis denylist:
  `revokeUserAccessTokens(userId)` (per-user epoch, kills all tokens issued
  before now), `revokeSessionAccessToken(sessionId)` (per-session),
  `isAccessTokenRevoked(userId, sessionId, issuedAtMs)`. TTL = access-token
  lifetime (self-cleaning). NEW `session-revocation.test.ts` (6 cases).
- Access token carries a millisecond `ims` claim (issueAccess); `verifyAccess`
  returns `issuedAtMs` (prefers `ims`, falls back to `iat*1000`). Millisecond
  precision fixes same-second false-rejections (a fresh login right after a
  revocation is not wrongly bounced) — found via the live E2E.
- `requireAuth` + `requirePermission` + `requireAnyPermission` reject a revoked
  token (the two permission guards factored onto a shared `authedUserId()` that
  also runs the check — they can be mounted standalone).
- Revocation wired at every session-kill site: admin ban / setUserActive(deactivate)
  / forceLogoutUser, moderation.revokeAllSessions, auth password-reset (all
  per-user); account.changePassword (per-session for the non-current sessions) +
  account.revokeSession + auth.tokens self-logout (per-session).
- BONUS bug (found by the E2E): `users.validation` validated profile-comment
  `commentId` as UUID, but the ids are cuid → update/delete/like/unlike all 422'd
  and never worked. Changed both schemas to `.cuid()`.

## #2 — Badge visibility vs group membership (BUGS.md #1)

- `auth.controller` `me` no longer runs `filterHiddenBadges` on `groups` — it
  returns FULL membership (client role-gating source of truth). Root cause:
  `PubNav.hasAcpAccess` / `AcpLayout` / maintenance gating all read `me.groups`,
  so hiding the admin badge revoked ACP access.
- Web: `AuthUser` gains `hiddenBadges` + derived `visibleGroups`; `normalizeUser`
  computes `visibleGroups = groups − hiddenBadges`. Self-badge display
  (PubNav nav badge, SecurityTab, ArticleEditor preview) uses `visibleGroups`;
  gating uses `groups`. Other viewers' badges still filtered server-side.

## #3 — Moderator profile-comment delete dead code (BUGS.md #6)

- `users.controller.deleteProfileComment` resolved `req.isModerator` (never set →
  always false). Now checks `profile.comment.delete.any` via NEW shared
  `permissionsService.userHasPermission(userId, key)`.
- De-duped `articles/comment.controller`'s private `hasPermission` onto the shared
  helper (removes the local prisma import).

## #4 — Marketplace account token encrypted at rest (audit A1.5)

- NEW `shared/utils/secretBox.ts` — AES-256-GCM, key derived from `COOKIE_SECRET`
  via scrypt; stored form `enc:v1:<base64(iv|tag|ct)>`. `decryptSecret` passes
  legacy plaintext through unchanged (backward-compatible, no migration). NEW
  `secretBox.test.ts` (5 cases incl. tamper rejection).
- Applied at all token access points: `marketplace-source` readSetting/writeSetting
  (K_TOKEN only), `license-engine.fetchAccountEntitlementJwt`, `jobs/updateCheck`.

## Dev-licensing removal (follow-up in the same PR)

- Removed the legacy `LICENSE_DEV_PRIVATE_KEY` local-signing path — licensing is
  always account/license-server via `connect()`. Deleted: env var (`config/env.ts`),
  `useDevLicensing` + all its branches (`marketplace-source.ts`), `signDevJwt` +
  `provisionEntitlement` + "dev stays manual" guards (`license-engine.ts`),
  `dev-catalog.ts` (`DEV_CATALOG`/`devEntitlements`), and the `updateCheck` early-return.
- Safe for plugin dev: the enable gate is by marketplace id
  (`pluginRequiresLicense` = id ∈ `paid_plugin_ids`), so an in-development / unknown
  id is ungated and enables with no entitlement. Disconnected instance →
  `paid_plugin_ids` empty → nothing gated. `listPlugins` returns empty (not a
  fabricated catalogue) when unreachable. `LICENSE_PUBLIC_KEY` kept as a verify-key override.
- Runtime smoke (API booted with no dev key): clean boot; `listPlugins` returns a
  valid empty response; unknown plugin id NOT gated; `getConnection` reports disconnected.

## Verification

- `pnpm backbone:check` — typecheck / lint / test / build green (14/14 tasks).
- API test suite: 52/52 (incl. 11 new unit tests across session-revocation,
  secretBox, sql-validator).
- **Live E2E against a running API + Postgres/Redis: 19/19 assertions** —
  deactivate/ban/force-logout/self-logout each reject the in-flight token (401)
  while a fresh login succeeds (200); `me` keeps the admin group after hiding its
  badge + exposes `hiddenBadges`; a permission-holding non-owner deletes a profile
  comment (204) while a no-perm non-owner is blocked (403); the stored marketplace
  token is `enc:v1:` ciphertext that decrypts round-trip, and legacy plaintext
  still reads.
- BUGS.md #1/#4/#6 struck (local list). Remaining: #2 dark dropdown, #3 members
  sort styling, #5 security-activity-log noise.

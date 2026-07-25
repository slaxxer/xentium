# Changelog

## Security hardening batch (Phase 17)

Four pre-v1 security/correctness fixes.

### Immediate session revocation

Access JWTs are stateless (15 min), so banning / deactivating / force-logging-out
a user, or a password change, previously left already-issued access tokens valid
until they expired. Added a short-lived Redis denylist (`session-revocation.ts`)
that `requireAuth`, `requirePermission`, and `requireAnyPermission` consult on
every request, so a revoked token is rejected on its **next** call:

- Per-user revocation (ban, deactivate, force-logout, password reset) records a
  revocation timestamp; any access token issued before it is rejected, while a
  fresh login afterwards is not.
- Per-session revocation (self-logout, "revoke this session", the non-current
  sessions on a password change) denylists just that session.
- Markers carry a TTL equal to the access-token lifetime, so they self-clean.
- Access tokens now carry a millisecond issue-time claim (`ims`) so the check has
  exact ordering — a token minted in the same second as a revocation is judged
  correctly (a fresh login is never wrongly rejected).

Also fixed a latent bug surfaced while E2E-testing the above: the profile-comment
update / delete / like / unlike endpoints validated `commentId` as a UUID, but
those ids are cuids — every call 422'd before reaching the handler, so those
endpoints never worked. Validation corrected to cuid.

### Badge visibility no longer affects group membership / access

Hiding a group badge in Account → Preferences dropped that group from the
`/auth/me` payload, which the client also uses for role gating — so hiding the
Administrator badge silently removed ACP access. `me` now returns full group
membership (identity), and the frontend derives a separate `visibleGroups` list
from `hiddenBadges` for the user's own badge display. Badges shown to other
viewers are still filtered server-side.

### Moderator profile-comment deletion restored

`deleteProfileComment` read a `req.isModerator` flag that nothing ever set (always
false → the moderator override was dead code). It now resolves the override from
the `profile.comment.delete.any` permission. Added a shared
`permissionsService.userHasPermission(userId, key)` and de-duplicated the
article-comment controller's private copy onto it.

### Marketplace account token encrypted at rest

The connected-account token lived as plaintext in `ncf_settings`. New
`secretBox` utility (AES-256-GCM, key derived from `COOKIE_SECRET`) encrypts it
on write and decrypts on read at all three access points (marketplace source,
license engine, update-check job). A version marker keeps legacy plaintext
tokens readable until their next write — no migration needed.

New unit tests: `session-revocation.test.ts` (6), `secretBox.test.ts` (5).

## Appearance & moderation UX fixes (BUGS.md #2/#3/#5)

- **Dark-mode dropdowns are readable again + a new Menu-text token.** Native
  `<select>` option popups defaulted to a white background in the dark theme
  which, with light option text, gave an unreadable white-on-white menu. The
  frontend now themes option popups with the menu tokens. Added a `--menu-fg`
  (Menu text) token to the registry + Style Editor Menu section, so dropdown
  text colour is configurable per light/dark alongside the existing menu bg /
  border / hover / radius.
- **`/members` sort buttons are now a Style Editor section.** New "Sort buttons"
  segment token group (`--seg-bg` / `--seg-fg` / `--seg-hover-bg` /
  `--seg-active-bg` / `--seg-active-fg`), rendered in the Style Editor with a
  live preview specimen and localized (en/de/es/fr/pt). The `mp-sortbox` control
  reads them (and gained a hover state).
- **Security-activity view is no longer flooded with automatic events.** The ACP
  user "security activity" list (`listUserLoginEvents`) excluded routine
  `refresh` (token rotation ~every 15 min) and beta-gate `page_visit` telemetry,
  which drowned out the meaningful auth events (login / failed / register /
  password change). Those rows stay in the table for the analysis job.

## Remove the dev-licensing (local-signing) path

Licensing now always goes through the connected account + license server; the
legacy `LICENSE_DEV_PRIVATE_KEY` local-signing shortcut is removed. It predated
the license-by-id enable gate and is no longer needed: a plugin under development
has an id the marketplace doesn't sell as paid, so `pluginRequiresLicense(id)` is
false and it enables with **no entitlement** — local plugin development needs no
faked license. Removed: the `LICENSE_DEV_PRIVATE_KEY` env var, `useDevLicensing`
branches in the marketplace source, `signDevJwt`, `provisionEntitlement`, the
`dev-catalog.ts` module (`DEV_CATALOG`/`devEntitlements`), and the "dev stays
manual" guards in the license engine. When the marketplace is unreachable or no
account is connected, the ACP marketplace list is simply empty rather than a
fabricated catalogue. `LICENSE_PUBLIC_KEY` remains as a general
entitlement-verification-key override.

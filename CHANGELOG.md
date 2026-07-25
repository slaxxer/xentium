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

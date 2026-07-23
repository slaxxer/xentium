# Changelog

## Deterministic primary group, faster dashboard, web/service dedup

- **Deterministic badge for multi-group users** — every query that picks "the"
  group for a user (badge colour on comments, notifications, online list,
  member suggestions, moderation views, `/auth/me`) now orders by the group's
  `displayOrder` (lower = higher priority). Previously the pick was database
  row-order and could flip between requests.
- **Dashboard analytics now aggregate in SQL** — one `GROUP BY` day query per
  series instead of loading every user/comment/article/login/report row in the
  window. Also fixes a subtle DST bug where events after a spring-forward
  crossing landed in the previous day's bucket.
- **One moderation list implementation** — the ACP and ModCP reports/warnings/
  bans lists now share a single implementation in the moderation service
  (previously near-identical copies with drift risk).
- **Shared web primitives** — `timeAgo` (10 per-page copies, several
  English-only, now one localized helper), `Badge` and `Pager` components.

## Unified API error contract (NEC/NodevoError everywhere)

- **One error shape** — every API error now returns the canonical
  `{ error: { code, message, details, severity } }` envelope produced by the
  central error middleware. The two legacy flat shapes are gone: the auth
  endpoints' bare strings (`invalid_credentials`, `account_banned`,
  `session_expired`, …) and the auth/permission middlewares'
  `unauthenticated`/`forbidden`/`invalid_token`. New NEC codes cover these
  paths: `NEC-AUTH-1008` (no token), `NEC-AUTH-1009` (invalid/expired token),
  `NEC-AUTH-1010` (no session cookie), plus `NEC-PERM-1001` for permission
  denials (now including the required permission keys in `details`).
- **Marketplace install/update errors are coded now** — download-gate failures
  carry `NEC-MARKETPLACE-9101/9102/9103` (no artifact / download failed /
  artifact failed verification) instead of a bare `{message}`. A side-effect
  bug fix: plugin-intake errors during a marketplace install (e.g. "already
  installed") keep their real NEC codes and HTTP statuses instead of being
  flattened to a generic 400.
- **Banned-login payload moved into `details`** — `reason`/`expiresAt` ride in
  the error envelope (`NEC-AUTH-1003` temporary / `NEC-AUTH-1004` permanent).
- **error_log noise control** — expected high-frequency rejections (guest
  refresh attempts, access-token expiry, failed credentials) no longer write
  rows to the ACP Error Log; real anomalies (permission denials, coded server
  errors) still do.
- **Auth input validation** unified onto Zod `parse()` → `422 NEC-API-4001`
  (previously ad-hoc `400 invalid_input`).
- **Frontend** — dual-shape error handling removed; three latently broken
  error-code checks fixed along the way (reset-password "link expired" message,
  beta-code redemption dialogs, register email/username-taken messages, which
  compared against the wrong shape and always fell back to generic errors).
  New error codes localized in all five languages.

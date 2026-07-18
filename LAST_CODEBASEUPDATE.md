# Last Codebase Update — 2026-07-18

## Explicit NEC codes for every known failure — UNCOMMITTED, with NODE_ENV flip

User-reported: enabling an unlicensed plugin surfaced as generic NEC-API-5000 + the fatal
full-screen overlay, because core engines threw plain `Error`s that fell through
errorMiddleware's unknown-error branch. Swept all 28 plain throws in apps/api:

- contracts nec.ts: +API_CONFLICT 4009 (was emitted by NodevoError.conflict but uncataloged),
  +PLUGIN_PACKAGE_INVALID 2002, +PLUGIN_ALREADY_INSTALLED 2003, +PLUGIN_MIGRATION_MISSING 2011,
  +PLUGIN_MIGRATION_CHECKSUM 2012, +LICENSE_ALREADY_ACTIVE 9008, +LICENSE_SERVER_REJECTED 9009,
  +CORE_STYLEPACK_INVALID 8002.
- plugin-engine.ts: package validation → 2002 (422), already-installed → 2003 (409), unlicensed
  enable → LICENSE_NOT_FOUND 9001 (402, the reported bug); validateManifest NodevoErrors pass
  through instead of being flattened. migration-runner.ts → 2011/2012; sql-validator.ts → 2010.
- license-engine.ts: already-active → 9008 (409), no account → 9005 (400), server 4xx → 9009
  (mirrors status + server message), server 5xx/network → 9007 (503) via licenseServerError().
- appearance.service.ts: 7 style-pack throws → CORE_STYLEPACK_INVALID 8002 (422) via
  stylePackError() helper.
- Left as plain Error deliberately: installer-engine (own pre-middleware error contract) and
  admin.routes' simulated-error dev endpoint (exists to test the 5000 path).
- Web: ErrorReferencePage catalog +9 entries (all new codes incl. 4009); 9003 cause text
  updated to canonical site.url.

Verified: backbone:check 19/19 green; e2e on patched test instance — enablePlugin('nodevo-forum')
(installed, unlicensed) now throws NodevoError {code NEC-LICENSE-9001, httpStatus 402} with the
actionable message → middleware renders it as warn-severity JSON, no fatal overlay, correct
Error Log severity.

## NODE_ENV defaults to production (safe-by-default) — UNCOMMITTED, post-PR#39

User decision: every instance runs hardened unless a developer explicitly opts into
development. `config/env.ts` NODE_ENV default `development` → `production` (an unset
NODE_ENV previously meant lax rate limits, the 000000 dev email-code backdoor, verbose
errors, and cap-exempt/never-domain-locked licensing). Dev opt-in paths: `./nodevo.sh`
now exports `NODE_ENV="${NODE_ENV:-development}"`; the dev checkout's `.env` already
carries NODE_ENV=development; `.env.example` + CLAUDE.md note the new default. The
installer still writes no NODE_ENV — production is the absence of configuration.
Verified: typecheck + 21/21 tests green (vitest sets NODE_ENV=test itself); test
instance (no NODE_ENV in .env) now reports env=production and serves normally
(web/css/config all 200; localhost still classifies as `staging` for licensing, so
domain caps don't bite local test installs).

Branch `development`. (Note: the toast/dialog WIP from 2026-07-11 — toast.ts/dialog.ts/hosts,
swal facade — is still uncommitted in the working tree alongside this change.)

## License ↔ account coupling on disconnect (both repos)

User-reported: disconnecting the marketplace account left the account-activated license
`active`; Refresh fell into the grace-period catch (missing token looked like an outage) and
kept a 30-day zombie alive. Account-derived licenses can never refresh without the token (the
raw key never reaches the instance — only the masked keyRef), so they now die with the coupling.
Manual-key licenses (`activatedVia: "key"`) are untouched — they stay the offline fallback.

**Core (API)**
- `core/license-engine/license-engine.ts`:
  - new `deactivateAccountLicenses()` — sets `active` + `activatedVia: "account"` rows to
    `deactivated` (rows kept: reconnect revives via the existing upsert).
  - `refreshLicense()`: account-activated license + no marketplace token (non-dev) →
    deactivate immediately instead of entering grace. Converges instances that disconnected
    before this fix.
- `core/license-engine/marketplace-source.ts` `disconnect()`:
  1. best-effort `POST /account/deactivate` (Bearer token) to the license server BEFORE
     wiping the token — revokes the token server-side (domain binding survives, see below);
     unreachable/missing endpoint never blocks the disconnect;
  2. wipes the three connection settings (as before);
  3. `deactivateAccountLicenses()`.
  `connect()` now also sends `environment` so the server can bind dev/staging domains
  without consuming the production slot.

**Core (web)**
- `features/admin/pages/LicensePage.tsx`: disconnect mutation now also invalidates
  `acp-license` (the license panel empties immediately after disconnect).

**Marketplace (~/Development/nodevo-marketplace — separate repo)**

Business-model correction from the user mid-session: 1 license = 1 instance; the license is
bound to the domain the plugins were bought for (free 1st year with purchase, ~100€/y renewal);
owners must NOT be able to move it to a new domain themselves — releasing a domain binding is
an ADMIN-ONLY support action (that friction is the anti-resale fence: a raw key can consume
slots but never free them).

- `Api/InstanceApiController.php` + `Core/App.php`: new `POST /api/account/deactivate`
  (Bearer + rate limit 30/h). Per the correction it now ONLY revokes the instance token
  (audit `instance.account_deactivate`) — the domain binding deliberately survives a
  disconnect; `connect` now accepts optional `environment`.
- `Service/MarketplaceApiService.php` `connect()`: **cap-bypass fixed** — it bound new
  domains with `enforceCap: false`, and the activate/download gates accept any pre-existing
  activation row without re-checking the cap, so connecting the account on a second install
  silently gave a 1-domain license a second domain. Now binds best-effort with the cap
  enforced (no free slot → connect still succeeds, gates 402 that domain). Also takes
  `environment` (default `production` for old cores) so dev/staging installs stop eating the
  production slot.
- Admin domain release (the required escape hatch): `LicenseRepository::findActivationById/
  deleteActivation`, `LicenseService::releaseActivation` (audit
  `license.activation_released`), `Admin/LicensesController::releaseActivation`, route
  `POST /acp/activations/{id}/release`, per-row Release button (confirm dialog) in the
  activations table on `templates/admin/account-detail.php`.

**Verified**: api+web typecheck clean, 21/21 API tests green, `php -l` clean on all 4 PHP
files. E2E on the test instance (/var/www/test-instance, patched, against LIVE bplaced
marketplace): (S1) the instance's real zombie state — active account license, no token —
refreshLicense() → `deactivated` immediately; (S2) seeded token + active license →
disconnect() → server call 404s (endpoint not deployed yet) and is swallowed, token wiped,
license `deactivated`. ⚠ Marketplace endpoint NOT yet on live bplaced (FTPS blocked on FTP
password) — until deployed, disconnects release nothing server-side (slot stays consumed,
as before).

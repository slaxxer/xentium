# Last Codebase Update — 2026-07-18

## Plugin-update toast + Style Editor "Update" slot — UNCOMMITTED

User request: informational (never forcing) toast when an installed plugin has an update,
shown on ACP entry, bg #414144, themable.

- `lib/toast.ts`: `update` is a 5th CORE category (7s) + `toast.update()` helper.
- `ToastHost.tsx/.scss`: faCircleUp icon; `nv-toast--update` → `--toast-update` →
  `--c-update` fallback chain (same pattern as the other categories).
- `styles/tokens.scss`: `--c-update` — #414144 light (user-specified), #8f8f94 dark
  (#414144 is invisible on dark cards). No hardcoded hex in JS — token rule respected.
- `StyleEditorPage.tsx`: Feedback section + "Update" color row; preview button fires an
  update sample.
- `AcpLayout.tsx`: `useUpdateToast()` in AcpShell — reads GET /admin/marketplace/updates
  (5-min staleTime; cache written by the daily update-check job), fires ONCE per update
  set (localStorage `nv-acp-updates-seen` = sorted pluginId@version hash), "View" action →
  /admin/marketplace; any critical update upgrades the toast to warning category.
- Locales ×5: marketplace.updatesToast_one/_other/updatesToastView (explicit keys, no
  i18next plural magic). CLAUDE.md toast convention line updated.
- ⚠ Toast only fires where the cache exists → needs the worker's update-check job (test
  instance runs no worker; seed `marketplace.updates` setting to demo).

Verified: web typecheck clean, 7 toast tests green, lint 0 errors.

## License page: account-mandatory, manual key removed — UNCOMMITTED

User decision (supersedes §53's "manual key = offline fallback"): the ACP requires a linked
marketplace account; there is no manual key entry anywhere.

- `LicensePage.tsx`: manual-key card + activate mutation REMOVED; standalone Deactivate
  button REMOVED (self-heal on refresh made it a trap — Disconnect is the one lever);
  connected-but-no-license state gains an "Activate from account" button (calls
  /admin/license/refresh → self-heal activates). Account card copy rewritten.
- API: `POST /admin/license/activate` route + controller handler REMOVED (comment marks
  why). `DELETE /admin/license` (deactivate) kept backend-only.
- license-engine: `activateLicense()` deleted (dead); `fetchEntitlementJwt` kept — it
  refreshes legacy `activatedVia:"key"` rows and backs provisionEntitlement; comments +
  the no-account error message updated. NEC LICENSE_ALREADY_ACTIVE (9008) stays cataloged
  (marketplace-side semantics + Error Reference).
- Locales ×5: license.* keys pruned (manual*/activate*/deactivate*/toastActivated/
  toastDeactivated), accountDesc/noLicenseHint rewritten, +activateFromAccount.
- CLAUDE.md license line updated (account link MANDATORY).
- ⚠ Consequence accepted by user: air-gapped/offline instances can install plugin FILES
  (portal Downloads) but cannot license paid plugins without connecting the account.
- Marketplace server keeps POST /api/activate (legacy-row refresh path) — untouched.

Verified: web+api typecheck clean, 21 API + 7 web tests green. (No browser click-through —
needs test-instance admin login.)

## v1-audit batch (gaps 1–5) — UNCOMMITTED both repos

User-commissioned after the licensing-workflow audit; HTTPS + payment gateways explicitly
deferred (no root server/domain yet — recorded in memory as official-v1 blockers).

**Core**
1. **siteId fix**: installer's finalize() always minted `ncf_installs.siteId`, but
   `getSiteId()` read the never-written settings key "site.id" → every instance reported
   "dev-site". Now reads the install row, is exported, and replaces the inline copies in
   admin.controller (authorize/install) + marketplace-source disconnect. refreshLicense()
   re-reads it and writes it back to the license row (heals pre-fix "dev-site" rows).
   E2E-verified on the test instance: getSiteId() = c81d21eb-73ee-49c7-86ad-63507400296e.
2. **Instant entitlement after purchase**: installFromMarketplace runs a best-effort
   refreshLicense() after install — Enable no longer 402s (NEC-LICENSE-9001) until the
   daily job.
5. **§16 update-check job**: new jobs/updateCheck.ts (worker) + `update-check` queue +
   scheduled daily 02:30 + workerBoot registration. POSTs installed inventory to
   /marketplace/updates (skips in dev licensing / when no account token), caches result in
   setting `marketplace.updates`. New GET /admin/marketplace/updates (adminGuard). ACP
   MarketplacePage shows an updates banner (critical badge + renewalRequired warning);
   +3 i18n keys in all 5 locales.

**Marketplace**
3. **connect() orphan-token fix**: bind/409 check moved BEFORE instance-token creation —
   a refused coupling no longer burns the auth code AND leaves a ghost portal row.
4. **www == apex**: DomainClass::normalize drops a leading "www."; ensureActivation and
   the updates() inventory-touch normalize before store/match. JWTs still carry the
   instance's own domain (core domain check unaffected). Unit cases extended (www.co,
   wwwx.com edge cases pass).

Verified: backbone:check 19/19; php -l + classifier unit cases all pass.

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

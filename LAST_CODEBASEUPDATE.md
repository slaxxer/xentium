# Last codebase update — 2026-08-23

**The instance ↔ marketplace link.** The CMS client spoke the deleted v1 protocol
(`/account/connect` with no siteId, `/marketplace/plugins`, unsigned everything);
the v2 marketplace serves `/api/v1` with Ed25519 request signing and install
binding. Nothing connected the two. Now it does, verified live against a running
marketplace — connect, activate, ownership, catalogue, download, heartbeat.

## New

| File | Purpose |
|---|---|
| `apps/api/src/core/license-engine/site-identity.ts` | `getSiteId` / `getSiteDomain` / `resolveEnvironment`, extracted from license-engine so the protocol client can ask "who am I" without an import cycle. |
| `apps/api/src/core/license-engine/protocol-client.ts` | The signed transport. Generates + stores the install's Ed25519 keypair (private half encrypted at rest), signs `{METHOD}\n{pathname}\n{ts}\n{sha256(body)}`, maps marketplace errors to NEC codes, persists rotated tokens. |
| `apps/api/src/core/license-engine/entitlement-claims.test.ts` | Regression guard on the entitlement claim shape (see below). |
| `apps/web/src/features/admin/components/OwnedLicenses.tsx` | ACP → License → "Your licences": what the account owns, seats, updates window, whether it is bound here, install if it is not. |

## Changed

- `marketplace-source.ts` — rewritten for `/api/v1`. Connect registers the public
  key; catalogue is server-paginated (the paid-id refresh walks every page);
  `listOwned()` is new; downloads send `kind`.
- `license-engine.ts` — activation goes through the signed protocol. The legacy
  manual-key `/activate` refresh now refuses with a coded error instead of
  calling a host that no longer exists. **`EntitlementPayload.entitlements` is
  `EntitlementGrant[]`, not `string[]`** — the marketplace has always signed
  objects (`{id, updatesUntil?}`); this side matched them as strings, so
  `getEntitlementStatus` returned `missing` for plugins the site owned, with
  every check green. `licenseKey` → `licenseRef`, matching what is signed.
- `jobs/updateCheck.ts` — heartbeat on `/updates/check`, advisories fold into the
  `critical` flag, rotated token stored first. **Single-flight Redis lock**: the
  worker fires one heartbeat on boot and the scheduler fires its missed run in
  the same millisecond, so rotation happened twice and stranded a token.
- `config/env.ts` — `LICENSE_SERVER_URL` defaults to
  `https://marketplace.nodelab.codes/api/v1` (the old default host is gone).
- `MarketplacePage.tsx` — prefers the marketplace's `owned` flag over the local
  JWT (a purchase made a minute ago is not in a JWT that refreshes daily); free
  plugins install without an entitlement instead of offering "Buy".
- `contracts` — `EntitlementGrant` published; `MarketplaceListing` gains `kind`,
  `owned`, nullable `latestVersion`; `DownloadRequest` gains `kind`.
- 5 locales: `owned.*`, `license.entitlementsHint`, and `license.accountDesc`
  rewritten (it still described domain binding).

## Marketplace repo (`~/Development/nodevo-marketplace`)

- `GET /api/v1/account/licenses` — the ownership direction of the protocol.
- Single-use download grants: `/downloads/authorize` now mints one and returns a
  real `downloadUrl`; `GET /api/v1/downloads/:token` streams the artifact once.
  `mkt_download_grants` existed and had never been used.
- **The updates window is enforced** at the download gate. It was signed into
  every entitlement and shown in the ACP while the gate ignored it, so renewing
  updates bought nothing.
- `optionalInstanceToken` on `/catalog` — `owned` was dead code without it.
- +9 tests (`ownership.e2e.test.ts`). Suite 59 → 68.

## Verified live, not just typechecked

Both halves running: connect → signed activate → entitlement verifies → owned
licences listed → `owned=true` in the catalogue → download grant → 404 on reuse →
heartbeat rotates the token once. The ACP renders both licences with seats and
updates windows, and a lapsed licence refuses to install with a renewal message.

## Docs

- **`docs/marketplace-protocol.md`** (new) — the outbound contract: install
  binding and why signing pays for it, the canonical string and the four ways to
  get it wrong, all eight endpoints, rotation on the heartbeat, the two-step
  download, and the entitlement claim shape. It exists because the claim shape
  drifted silently once; the doc says so, at the top.
- `docs/API.md` — the licensing table was rewritten. It still documented
  `POST /license/activate`, removed 2026-07-18, and had no `/marketplace/owned`,
  `/updates`, `/install`, `/update` or `/status-summary`.

## Known, not done

- ACP browse shows one page (limit 20) with no pagination UI — fine at 14
  listings, silently truncating past 20.
- `popular` catalogue sort still falls back to alphabetical.
- VAT is displayed but never charged (marketplace side, unchanged).

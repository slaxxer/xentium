# Last codebase update — 2026-08-28

Wiring an install to a marketplace account, end to end. Two repos: this one and
`nodevo-marketplace` (private). The protocol doc is updated in the same pass, because the
two halves of it once drifted with nothing to disagree with.

## Part 1 — the enable gate (CMS)

The gate was wrong in three ways at once, and each looked like the others from the ACP.

| File | Purpose |
|---|---|
| `apps/api/src/core/license-engine/license-engine.ts` | New `assertPluginEnableAllowed()` + `explainEnableRefusal()`. Re-syncs the paid-id set, asks the marketplace once before refusing, then names the actual reason by consulting `/account/licenses`. |
| `apps/api/src/core/license-engine/marketplace-source.ts` | `refreshPaidPluginIds()` returns whether it wrote; new `ensurePaidPluginIdsFresh()` (15-min TTL off the settings row's own `updatedAt`) returning `fresh` / `stale` / `never`. |
| `apps/api/src/core/plugin-engine/plugin-engine.ts` | `enablePlugin` calls the gate instead of hand-rolling the check. |
| `apps/api/src/core/license-engine/enable-gate.test.ts` | **New**, 14 tests. Asserts the messages, because the message *is* the feature: a 402 naming the wrong remedy is the bug. |
| `apps/api/src/core/license-engine/paid-ids-freshness.test.ts` | **New**, 7 tests over the TTL and the three freshness answers. |

⚠ **`never` vs `stale` is load-bearing.** A cached set that survives an outage still says
something about which ids are paid, so the gate keeps using it. Only "we have never managed
to fetch one" falls through to the package's own `licenseRequired` flag — and that flag may
only ADD caution, never remove it. Trusting a `false` there would reopen the
repackage-a-paid-plugin-as-free hole the by-id design closes; trusting a `true` at most asks
an offline admin to connect an account. Both directions are tested.

⚠ The gate is **not** on the boot path — `initializePlugins` calls `callPluginHook(…,
"onEnable")` directly, not `enablePlugin`. A marketplace outage cannot disable a running
plugin at restart. Worth re-checking if that ever changes.

## Part 2 — the one-click handshake

OAuth **device grant** shape. An install cannot receive a browser redirect it can prove came
from the marketplace, so nothing is redirected back and the install polls — which removes
the `redirect_uri` surface rather than defending it.

### Marketplace (`nodevo-marketplace`)

| File | Purpose |
|---|---|
| `prisma/schema.prisma` + `migrations/20260828132045_link_requests` | `LinkRequest` / `mkt_link_requests`. Holds no credential: `pollSecretHash` only, and the account token is minted at claim time. |
| `src/modules/licensing/link.service.ts` | **New.** `startLink` / `pollLink` / `describeLink` / `decideLink`. |
| `src/modules/licensing/licensing.service.ts` | `registerInstance()` factored out of `connect()` — the shared tail of BOTH ways in, so the "already registered to another account" guard cannot be true of only one. |
| `src/shared/middleware/signedRequest.ts` | `assertSignedWith(req, publicKey)` split out of `requireSignature`. The handshake verifies against a key that is not in the database yet; the skew window and canonical string must not fork. |
| `src/modules/licensing/{licensing.routes,licensing.controller,licensing.validation}.ts` | `POST /api/v1/account/link/{start,poll}` — unauthenticated, signed. |
| `src/modules/portal/portal.routes.ts` | `GET /portal/link/:linkId`, `POST …/approve`, `POST …/deny`. |
| `web/src/pages/LinkApprove.tsx` + `.scss` | **New.** The approval screen, routed at `/link/:linkId`. |
| `src/modules/licensing/link.e2e.test.ts` | **New**, 13 tests: the loop, single-use claim, supersede, expiry, and five refusals. |
| `src/test/reset.ts` | `linkRequest.deleteMany()`. |

### CMS

| File | Purpose |
|---|---|
| `apps/api/src/core/license-engine/protocol-client.ts` | `marketplaceWebUrl()`; `optionalToken` now means "do not REQUIRE a token" so a call can be signed but pre-account. |
| `apps/api/src/core/license-engine/marketplace-source.ts` | `startLink()` / `pollLink()`. Approval stores the token exactly as `connect()` does — it *is* a connect. |
| `apps/api/src/modules/admin/marketplace.service.ts` | `startLink` / `pollLink`, plus `linkSecrets`: an in-memory map, so an abandoned handshake leaves no claim credential in the database. `getConnection()` now returns `accountUrl` + `licencesUrl`. |
| `apps/api/src/modules/admin/{admin.controller,admin.routes}.ts` | `POST /admin/marketplace/link`, `GET /admin/marketplace/link/:linkId`. |
| `apps/api/src/config/env.ts` | `MARKETPLACE_WEB_URL` (optional). |
| `apps/web/src/features/admin/pages/LicensePage.tsx` + `.scss` | Connect is one button; the code is displayed for comparison while polling; the typed code is a `<details>` fallback. |
| `apps/web/public/locales/{en,de,es,fr,pt}/acp.json` | 10 new keys; `license.connectHint` corrected. |
| `docs/marketplace-protocol.md`, `docs/API.md` | The handshake, and a section on the enable gate's use of `/account/licenses`. |

⚠ **The poll secret never reaches the browser.** The ACP holds the id, the code and the URL,
and polls through its own API — the same rule the download gate follows for the account
token.

⚠ `pending` / `denied` / `expired` are **200s**. This is called on a timer while a person
reads a screen; a 4xx would make the normal case look like a failure in every log it touches.

## Part 3 — one button size system

Prompted by "make the Connect button bigger", which turned out to be a symptom.

| File | Purpose |
|---|---|
| `apps/web/src/styles/tokens.scss` | `--btn-pad-y` / `--btn-pad-x` / `--btn-fs` / `--btn-fw` / `--btn-gap`. |
| `apps/web/src/styles/buttons.scss` | A `%btn-box` placeholder every variant extends; `.btn-sm` and a new `.btn-lg` are TOKEN SWAPS, not padding overrides. |
| `apps/web/src/features/admin/AcpLayout.scss` | Its `!important` `.btn-sm` deleted; `.btn-ghost-danger` reads the shared box. |
| `apps/web/src/features/{account/AccountPage,profiles/ProfilePage}.scss` | Their own `.btn-sm` definitions deleted. |
| `apps/web/src/features/admin/pages/ScheduledJobsPage.scss` | `padding: … !important` → `--btn-pad-y: var(--sp-3)`. |
| `apps/web/src/features/admin/pages/LicensePage.{tsx,scss}` | Rail buttons drop `btn-sm`; full-width rule covers `.btn-ghost` too. |

⚠ **There were THREE global `.btn-sm` definitions** — ACP (`sp-1 sp-3`/`fs-xs`, every property
`!important`), account (`sp-1 sp-3`/`fs-sm`), profile (`sp-2 sp-3`/`fs-sm`) — in one cascade,
so which size a small button got depended on stylesheet order. `.btn-ghost` was also a step
narrower and a weight lighter than `.btn-primary`, and `.btn-ghost-danger` had `padding: 0`
vertically. The ACP's values won, so the ACP does not shift; account/profile small buttons
get marginally smaller.

⚠ A size modifier sets tokens **on the element**, so it beats `:root` without specificity
games and without `!important`. That is the property that let the Scheduled Jobs workaround
go away.

## Part 4 — the marketplace could not be signed out of

| File | Purpose |
|---|---|
| `web/src/components/AccountMenu.tsx` + `.scss` | **New.** The account chip, and the menu behind it. |
| `web/src/components/Header.tsx` | The chip was a `<Link to="/account">`; it is the menu now. |
| `web/src/components/Header.scss` | `&__account` / `&__avatar` / `&__accountName` moved out — the chip owns a popover, so its styles live with the component that opens it. |

⚠ `logout()` existed on the auth context from the start and **nothing called it**. The header
looked complete, which is why it survived. Closes on outside click, Escape and route change;
listens on `mousedown` rather than `click`, or the listener catches the very click that
opened the menu. Sign-out navigates home — half these routes need an account and would bounce
to `/auth`, which reads like the sign-out failed.

## Part 5 — "connected" was being reported as "licensed"

Found by the owner asking the right question: *why does a brand-new account that has bought
nothing show an active licence?* It does not just look wrong — it drives a badge.

| File | Purpose |
|---|---|
| `apps/api/src/modules/admin/licenseAttention.ts` | **New.** `licenseAttention()` + `countGrants()` — the whole rule, and why, in one place. |
| `apps/api/src/modules/admin/licenseAttention.test.ts` | **New**, 12 tests. Includes a guard that the threshold stays below the refresh floor. |
| `apps/api/src/modules/admin/marketplace.service.ts` | `getStatusSummary` uses it; `EXPIRING_SOON_DAYS = 30` deleted. |
| `apps/web/src/features/admin/pages/LicensePage.tsx` | New hero state: connected, zero grants → "Connected — no licences yet". |
| `apps/web/public/locales/*/acp.json` | 3 keys × 5. |

⚠ **`expiresAt` on the entitlement is NOT a subscription end date.** The JWT is issued with a
30-day life and `refreshAfter` of 7 days, so a healthy install sits 23–30 days out
permanently. The old rule (`daysLeft <= 30`) was therefore true from the moment of connection
and true forever: **every connected install in the field showed a red urgent badge**, paying
customers included, plus the ACP-entry dialog. The threshold must stay BELOW the cycle's
floor of ~23 — it is 7 now, and a test fails if it creeps up.

⚠ **A zero-grant entitlement is a normal state, not a lapse.** `/account/activate` signs a
document even when the account owns nothing, because connecting is not buying. Nothing in it
can expire, so it produces no warning and no anchor.

⚠ `countGrants` **decodes and does not verify**, deliberately: it decides whether to show a
WARNING, and an unreadable token must not invent one. Refusing *access* on a bad token is
`getEntitlementStatus`'s job, and that verifies properly.

## Part 6 — the rename, and an empty panel that was making a claim

| File | Purpose |
|---|---|
| `prisma/schema.prisma` | `License` → **`Entitlement`**, `ncf_licenses` → **`ncf_entitlements`**, `licenseKey` → **`licenseRef`** (`license_ref`). The model carries the distinction in a doc comment. |
| `prisma/migrations/20260828200000_entitlement_rename/` | **New**, hand-written. |
| `apps/api/src/core/license-engine/license-engine.ts` | 9 `prisma.license.*` → `prisma.entitlement.*`; upsert key is `licenseRef`. |
| `apps/api/src/modules/admin/admin.service.ts` | `getActiveLicense()` → `getActiveEntitlement()`. |
| `apps/api/src/modules/admin/{admin.controller,admin.routes,marketplace.service}.ts` | Callers. |
| `apps/web/src/features/admin/pages/LicensePage.tsx` | `licenseRef`; Entitlements rail card gated on `entitlements.length > 0`. |
| `apps/web/public/locales/*/acp.json` | `license.fieldKey`: "License key" → "Licence reference". |
| `enable-gate.test.ts`, `entitlement-claims.test.ts` | Their prisma mocks named `license`. |

⚠ **`ALTER TABLE … RENAME`, never drop-and-recreate.** The row is an install's proof of what
it may run and can only be re-issued by reaching the marketplace; a migration that emptied
the table would unlicense every install until its next successful refresh, and offline ones
indefinitely.

⚠ **Postgres does not rename constraints with their table.** The names in the field were
still `licenses_pkey` / `licenses_license_key_key` — created as `licenses`, renamed to
`ncf_licenses` by `20260612200000_ncf_table_prefix`, which moved the table only. Prisma
derives the names it expects from table + column, so leaving them stale shows up later as
drift. The migration renames them, handling BOTH spellings in a `DO` block rather than
assuming.

⚠ Applied by hand then `prisma migrate resolve --applied`, because `migrate dev` writes a
DROP/CREATE for a rename.

⚠ **The route and the page are still "License" deliberately.** Admins think in licences and
that word is correct where a person is reading. Storage was the thing that was lying.

## Part 7 — an install that walked away still counted (marketplace only)

`deactivate()` released the seats and revoked the token and stopped there, so `mkt_instances`
had no idea a site had uncoupled. The operator console's "Connected installs" listed it like
a live one; nothing recorded that it had left.

| File (`nodevo-marketplace`) | Purpose |
|---|---|
| `prisma/schema.prisma` + `migrations/20260828190242_instance_connection_history` | `Instance.disconnectedAt` + `connectionCount`, and `InstanceEvent` / `mkt_instance_events` — the couple/uncouple log, with the domain and environment **as reported at that moment**. |
| `migrations/20260828190500_instance_disconnect_backfill` | Flags installs that uncoupled before the column existed. The signal is what the old `deactivate` left behind: tokens exist, none of them live. Writes no history events — those disconnects were never observed. |
| `src/modules/licensing/licensing.service.ts` | `deactivate` keeps the row and flags it; `registerInstance` clears the flag, counts the connection and logs it; `rotateToken` stamps `lastSeenAt`. |
| `src/modules/ops/ops.routes.ts` | The customer page returns `active`, `disconnectedAt`, `connections` and the last 6 events. `active` is derived server-side, once — two screens deciding for themselves what a null date means is how they end up disagreeing. |
| `src/modules/portal/portal.service.ts` | `/portal/instances` reports the same status. No UI consumes it yet. |
| `web/src/pages/ops/OpsCustomer.tsx` + `OpsSettings.scss` | Section is **Installs**, counted `N active · M inactive`; inactive rows dimmed with a dashed INACTIVE badge and a `disconnected <date>`; `×N connects`; per-install timeline underneath. |
| `src/modules/licensing/connection-history.e2e.test.ts` | **New**, 4 tests: the row survives, a reconnect reclaims it (no duplicate), a second deactivate does not move the timestamp, and the ops payload says `active: false` with its history. |

⚠ **The guard on the second deactivate is not decoration.** `updateMany … where disconnectedAt
is null`, so a retry from the CMS — which is a normal thing for it to do — cannot rewrite when
the site actually left.

⚠ **Dimming is applied to the row's CHILDREN, not the row.** `opacity` on a parent cannot be
undone by a child, so the first version faded the INACTIVE badge along with everything it was
meant to explain.

**Verified in the browser**, not just in the suite: `test.local / 196600a5-…` on the dev
console now reads **INACTIVE · disconnected 8/28/2026** under "Installs — 0 active · 1
inactive", from the backfill. The timeline was checked by seeding three events, screenshotting
and removing them again.

## Verified

`pnpm backbone:check` exit 0 — **478 web tests, 169 API tests (was 148), 0 lint errors.**
Marketplace suite: **132 (was 119)**.

In the browser, against both dev stacks running (CMS 4000/5173, marketplace 4200/4210):

| Step | Result |
|---|---|
| `POST /account/link/start`, signed by a throwaway install | 201, code `VT2-W9J` |
| `/link/:id` in the browser | renders the code, `staging.kern.studio`, install id, `production`, and the mismatch warning |
| Approve | settles; reload shows **Connected** |
| `POST /account/link/poll` from the install | `approved` + a live 30-day token |

ACP, in the browser (an admin session was already live):

| Check | Result |
|---|---|
| `/admin/license`, not connected | full-size **Connect marketplace account**, full width |
| "Open my marketplace account" link | `http://localhost:4210/account` — served, not guessed |
| Click Connect | waiting state: code `DCK-4GP`, spinner, reopen link, cancel; approval tab opened |
| Approval screen | same code, `test.local`, install id, **development** (so no seat) |
| Approve as the WRONG account | ACP cleared the wait and showed *"This install is already registered to a different account."* — the marketplace's own message, carried across the protocol |
| Approve as the RIGHT account | ACP flipped to **Connected** on its own poll: hero "Licensed until Sep 27, 2026", account `t•••@w.cn`, signed-until +30d, next check +7d. Dates read as 2028 in a screenshot — that was JPEG blur, confirmed 2026 from the DOM |
| `/admin/installed` | Disable (ghost) and Remove (danger) are the same height |
| 404 page | "Take me home" and "Go back" match |
| **Enable gate, against a genuinely stale cache** | `marketplace.paid_plugin_ids` was dated **2026-08-23** (5 days old, the exact bug). Disabling + re-enabling Shoutbox moved `updatedAt` to the second of the click. `halide`/`quarry` stayed out because they are THEMES — the walk asks `kind: "plugin"` |
| Phantom licence badge | red `1` on the gear (`--c-danger`, `urgent`) with 0 updates and 0 licences → **gone** after the fix |
| Hero, zero grants | green "Licensed until Sep 27, 2026 · Active" → **"Connected — no licences yet · No licences"** |
| Hero, one grant | inserted a dev licence for `test@w.cn` → Refresh → "Licensed until … · Active", Grants 1, row `Messaging · NDV-DEV0-TEST · 0/3 · Not active · Install`. Removed it again → back to the honest state |
| "Not active" on that row | **not a bug** — `rowIsLive` deliberately needs `activeHere` AND an installed version, so a licensed-but-uninstalled row says so and offers Install |
| Rename, end to end | API restarted on `ncf_entitlements`; page loads, technical details reads `LICENCE REFERENCE = NVL-account`. Both existing rows survived the migration |
| Entitlements rail card | present with Grants 0 → **gone**; hero unchanged |
| Sign-out | menu closed, chip gone, header back to "Sign in", navigated home, and **0 live portal sessions of 4** — revoked server-side, not just cleared locally |

Both halves of the loop are now browser-verified end to end, including the refusal paths.

## Dev-state notes

- **`mkt_accounts` was reset** (7 rows) at the owner's request — nobody remembered the old
  dev passwords. All account FKs are `CASCADE`, so instances, licences, activations, orders,
  order items, portal sessions, account tokens and link requests went with them. **Kept: 20
  products, 30 releases, 10 audit events** (the audit table has no FK to accounts, so its
  immutability trigger was never involved).
- New dev accounts, registered by the owner: `hi@ich.codes` (**staff**, promoted with a
  single `UPDATE … WHERE email` after registration — never created for them) and
  `test@w.cn` (customer).
- The dev CMS install is connected to **`test@w.cn`**, because that is who approved the
  verification run. If purchases should be tested from the admin account instead, disconnect
  and reconnect — that is the ordinary move now, not a support ticket.
- The dev CMS install `196600a5-…` belongs to **`test@w.cn`** (the account reset took the
  old owner with it). Reconnecting it through the handshake must be approved while signed in
  as that account, or the marketplace refuses with 409 — an install belongs to one account.
  It currently reads INACTIVE: it was disconnected during the licence-gate verification and
  the backfill dated it accordingly.

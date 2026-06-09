# ADR 0001 — Marketplace Entitlement: per-domain, download-gated

- **Status:** Accepted
- **Date:** 2026-06-02
- **Supersedes:** the "v2 Plan" note in CLAUDE.md §11 (account connection is now v1 core)
- **Relates to:** §11 (License System), §15 (Marketplace), §42 (ACP), §49 (`licenses` schema)

## Context

v1 shipped the manual-license-key model exactly as §11 described: an admin pastes
a key, core exchanges it with `LICENSE_SERVER_URL` for an RS256-signed entitlement
JWT, stores it in `licenses`, and `isPluginEntitled()` verifies it at plugin-enable
time. §11 parked "connect your marketplace account" as a v2 idea.

Surveying how real platforms enforce paid extensions (WoltLab, XenForo, Invision)
showed a consistent pattern, and none of them rely on a heavy runtime check:

1. **Account-based ownership** on the vendor store.
2. **Domain/URL binding** recorded server-side.
3. The real chokepoint is the **authenticated ACP→store download/update channel** —
   you can only pull the artifact if your account + your domain owns it.
4. Runtime on the installed add-on is light / trust-on-install, because once the
   code is on the customer's server, runtime DRM is theater.

This is effectively the WoltLab model, and it matches the grain Nodevo already has:
the `licenses` row binds an entitlement to a `site_id` minted at install.

## Decision

Promote account-connection + domain-binding into **v1 core**. Specifically:

### 1. License grain = per-domain
One plugin purchase entitles **one production domain**. Additional domains are
separate purchases / add-domains. Non-production activations (`staging`,
`development`) are flagged by `environment` and are **not** counted against the cap
and are **not** domain-enforced. (WoltLab model; chosen 2026-06-02.)

### 2. Enforcement chokepoint = the authenticated download, not runtime
The marketplace answers *"does account X + domain D own plugin P?"* and only then
issues a domain-bound entitlement (and, in prod, serves the `.nvplugin`). The money
is protected at the download gate. Runtime stays light.

### 3. Account connection is server↔server, never browser/localStorage
The admin clicks "Connect account" once and authorizes with an auth code. The
resulting token lives **server-side in `settings`** (`marketplace.<source>.token`),
attached to every `MarketplaceSource` call. The browser is never in the download
path. The manual license key remains as the **offline fallback** (XenForo-style),
exchanged for the same domain-bound entitlement.

### 4. Two interfaces, pluggable
- `MarketplaceSource` (download gate): `connect` / `disconnect` / `listPlugins` /
  `authorizeDownload`. Core talks to a *source*, never hardcodes nodevo.io — a
  community/self-hosted source implements the same interface (can return free,
  no-op entitlements).
- `EntitlementProvider` (light runtime): `check` / `refresh`. Verifies the stored
  domain-bound JWT with the bundled public key; honors the existing 30-day grace.

### 5. Domain binding is enforced only in `production`
`environment` is derived once from `NODE_ENV` + the `APP_URL` host. In
`development` / `staging` the domain assertion is skipped, so local dev, CI, and
staging never get domain-locked. This keeps the per-domain teeth where revenue
lives (production) without making non-prod painful.

## Schema impact (v1 core)

`licenses` gains two nullable columns (back-compatible):

| Column | Meaning |
|---|---|
| `domain` | `APP_URL` host bound at activation time |
| `environment` | `production` \| `staging` \| `development` |

The **activations cap** itself (count of production domains per purchase) is
authoritative on the marketplace server, not in core. Core records the single
domain *this* site is bound to and proves it at the download gate.

The entitlement JWT payload gains `domain` and `environment` claims alongside the
existing `siteId` / `entitlements[]` / `expiresAt` / `refreshAfter`.

## Consequences

- §11's "v2 Plan" line is now implemented in v1; the manual key is demoted to a
  fallback path.
- Core never trusts a self-reported domain: the domain is a signed claim in the
  entitlement, bound at issue time by the source.
- Community/self-hosted marketplaces are a first-class extension point, not a
  special case.
- Heavier marketplace concerns (purchase records, activation caps, re-bind UI) live
  on nodevo.io; core stays a thin, prod-correct client.

## Open follow-ups (not blocking this ADR)

- **Domain re-bind on migration** (`old.com → new.com`): self-service deactivate-old
  + claim-new vs. support-only. Decides whether `MarketplaceSource` needs
  `reactivate(domain)`. Deferred.
- **Token TTL**: default leans on the daily refresh job + 30-day grace (§11). Current
  dev signer issues 1y/refresh-30d; a shorter prod TTL (~7d / refresh 1d) is a
  server-side policy, transparent to core.
- **Encryption at rest** for the connection token in `settings` (currently stored as
  JSON like other settings). Tracked as hardening.

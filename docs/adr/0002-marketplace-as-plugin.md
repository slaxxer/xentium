# ADR 0002 — Marketplace stays core; opt-in by use, not split into a plugin

- **Status:** Accepted
- **Date:** 2026-06-02
- **Affirms:** the frozen Phase 15 / §15 layout (marketplace in core) and §42 (ACP →
  Extensions → Marketplace as a core page). ADR 0001's implementation locations are
  **unchanged** — the nodevo.io `MarketplaceSource` stays in `core/license-engine/`.
- **Relates to:** §10 (Plugin System), §11 (License System), §15 (Marketplace),
  §42 (ACP nav), §54 (Plugin engine operational details)

## Context

An open discussion proposed moving the marketplace *storefront* out of core into an
official free `nodevo-marketplace` plugin, leaving only the plugin engine + entitlement
verification in core. The motivation was that ADR 0001 made `MarketplaceSource` pluggable
("core never hardcodes nodevo.io"), so shipping the nodevo.io source as a plugin looked
like the consistent next step.

On review the decision is **not** to split it. Two things settle it:

1. **The download gate must be trusted, and trust lives in core.** `authorizeDownload`
   mints/stores a domain-bound entitlement and is the point where money is protected
   (ADR 0001 §2). Even though a plugin could only *relay* a signed JWT and not *forge*
   one, putting the gate and the server-side connection token (`settings['marketplace.
   <source>.token']`) behind a removable, separately-versioned plugin adds a moving part
   to the exact path that has to stay dependable. Keeping the gate core-side keeps the
   trust boundary simple.
2. **"Marketplace" is already optional at runtime — it does not need to be optional at the
   code level.** An admin who wants premium plugins connects an account or pastes a key; an
   admin who does not simply never touches the page. That opt-in behavior exists today with
   the marketplace in core. Extracting it into a plugin buys removability nobody asked for
   while adding bootstrap (chicken-and-egg: needing a store to get the store), a host-bridge
   surface (`installFromAuthorized`), and a second build/package to maintain.

`MarketplaceSource` remaining a real interface still delivers the ADR 0001 goal: a
community / self-hosted source is a swappable implementation, not a fork. It just does not
have to be a *plugin* to be swappable.

## Decision

**The marketplace is a core capability. It is opt-in by use, not by installation.**

- The **plugin engine**, the **license engine** (including the full `MarketplaceSource` —
  `connect` / `disconnect` / `getConnection` / `listPlugins` / `authorizeDownload`, the
  `DEV_CATALOG` mirror, and the `EntitlementProvider`), the `licenses` store, manual
  license-key activation, and the `/api/admin/marketplace/*` + `/api/admin/license/*`
  routes all **stay in core**, where they are today.
- ACP → Extensions → **Marketplace / Installed / Upload / License** all remain **core**
  pages.
- An operator who never connects an account and never buys a plugin uses none of it; core
  is fully functional without premium plugins (§57). Offline/airgapped installs still work
  via **Upload** + the manual **License** key.
- `MarketplaceSource` stays an interface in `@nodevo/contracts` so an alternative
  (community / self-hosted) source can be dropped in **as a core configuration**, not as a
  plugin. nodevo.io is the default source, selected by `LICENSE_SERVER_URL` presence.

Nothing changes in the current code. This ADR records *why* the split was declined so the
question is settled rather than re-litigated.

## Considered alternatives

### A — Move the storefront + nodevo.io source into an official free plugin (the proposal)
Core would keep only the engine + `EntitlementProvider`; `nodevo-marketplace` would own the
storefront UI, the source implementation, and `DEV_CATALOG`, calling a new
`host.pluginEngine.installFromAuthorized()` bridge.
**Rejected:** puts the trusted download gate and the connection token behind a removable
plugin, and introduces bootstrap + host-bridge + packaging complexity to make optional
something that is already optional at runtime.

### B — Thin UI-only plugin over core's `/marketplace/*` routes (gate stays core)
A middle option: gate/source/token core-side, only `MarketplacePage.tsx` shipped as a
plugin so the page can be removed.
**Rejected:** a plugin whose only job is to render a page that calls core routes is
ceremony without payoff. If an operator wants the page gone, hiding the nav entry / gating
on a setting is simpler than a separate package.

## Consequences

- **No code changes.** Current marketplace/license code and ACP pages are correct as-is;
  this ADR makes that explicit and closes the open discussion.
- **The trust boundary stays where it is** — entitlement minting, verification, and the
  connection token are all core, none of them reachable through plugin install/disable.
- **Community / self-hosted marketplaces remain supported** via the `MarketplaceSource`
  interface, configured in core rather than installed as a plugin.
- **ADR 0001 is fully intact**, including its "Implementations live in
  `core/license-engine/`" note. This ADR does not supersede any part of it.

## Open follow-ups (unchanged from ADR 0001, not blocking)

- Encryption-at-rest for the connection token in `settings`.
- Domain re-bind on site migration (`MarketplaceSource.reactivate?`).
- Short prod entitlement TTL (server-side policy).

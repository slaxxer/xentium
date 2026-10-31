## 1.0.0-rc.4

The fourth release candidate for 1.0.0: a redesigned Marketplace page, listings in your
language, and maintenance mode that no longer cuts off services other sites depend on.

### Changed

- **ACP → Extensions → Marketplace is redesigned.**
  - A licence strip says how many of the paid listings your licence covers, and folds
    out exactly what it grants.
  - One toolbar holds the Plugins and Themes tabs with their counts, the search, and
    filters for All, Enabled, Available and Free.
  - Every card is the same height, with the listing's own icon and colour, how closely
    it was reviewed, the price, and the one action that fits: Enabled, Enable, Install,
    or Buy, which opens the listing in the store.
  - Themes keep their screenshot, preview and the warning about pieces your site can't
    show yet.
- **The Marketplace speaks your language.** Listing descriptions come in the language
  you use the ACP in wherever the store has a translation, and in English otherwise.

### Fixed

- **Maintenance mode no longer cuts off what other sites depend on.** It closed every
  part of the site to everyone but admins, including routes that other sites or payment
  providers call. An add-on can now keep those few routes open while the rest of the
  site is in maintenance.

### For plugin developers

- `ctx.keepOpenDuringMaintenance(prefixes)` keeps routes that machines call (other
  sites, webhooks, feeds) reachable while the site is in maintenance. See "Staying
  reachable in maintenance" in the plugin extension points.
- Marketplace listings can carry `icon`, `accentColor` and `storeUrl`.

## Upgrading

- Update from the ACP or run `npx xentium update 1.0.0-rc.4` in your site's folder.
  No database changes.

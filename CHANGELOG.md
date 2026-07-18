# Changelog

## License: v1-audit fixes — site identity, instant entitlements, update visibility

- **Instances now identify themselves correctly to the marketplace.** The installer has
  always minted a site UUID (`ncf_installs.siteId`), but the license engine read an
  unwritten settings key and reported `"dev-site"` for every install. `getSiteId()` now
  reads the install row and is the single source everywhere (activation, download,
  disconnect); a license refresh also heals rows that were activated with the wrong id.
- **A just-bought plugin is usable immediately.** Direct marketplace install now refreshes
  the entitlement right after the package lands — previously Enable failed with
  `NEC-LICENSE-9001` until the daily refresh job, because the stored entitlement JWT
  predated the purchase.
- **Daily marketplace update check (§16).** New `update-check` worker job reports the
  installed plugin inventory and caches what comes back: newer versions, critical flags,
  and renewal warnings. ACP → Extensions → Marketplace shows the results (critical badge,
  renewal notice); `GET /admin/marketplace/updates` serves the cache. Customers now see a
  lapsed term before downloads start failing.

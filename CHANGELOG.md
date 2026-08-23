# Changelog

## Instance ↔ marketplace integration

The CMS now speaks the v2 marketplace protocol. Every call after connect carries
an account token and an Ed25519 signature over the request, which is what lets a
licence bind to the install rather than to its hostname — rename a site or move
it to a new host and nothing needs reissuing.

### Added
- ACP → Extensions → License now lists **what your marketplace account owns**:
  each licence, its seats, its updates window, whether it is active on this
  install, and a one-click install for anything you own but have not installed.
- The catalogue marks what you already own, straight from the marketplace — a
  purchase made a minute ago shows up immediately.

### Docs
- `docs/marketplace-protocol.md` documents the contract between an install and a
  marketplace — signing, endpoints, token rotation, and the entitlement claim
  shape. The API reference's licensing section was rewritten; it still listed a
  manual key-activation route removed in July.

### Fixed
- **A licensed plugin could report as unlicensed.** The marketplace signs
  entitlement grants as objects; this side compared them as strings, so an owned
  plugin resolved to "missing" and refused to enable. Guarded by a test.
- Free plugins offered "Buy" instead of installing.
- The daily marketplace heartbeat could run twice at once on boot and rotate the
  account token twice, stranding one.
- Legacy manual license keys now fail with a clear message pointing at account
  connection, instead of retrying a server that no longer exists.

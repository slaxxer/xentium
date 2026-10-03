# Changelog

## Small fixes

### Fixed

- **`xentium update` no longer refuses a newer prerelease.** It compared the prerelease part as
  text, so `1.0.0-alpha.10` looked older than `1.0.0-alpha.9`. Numbers in a prerelease now
  compare as numbers.
- **The links on ACP → System → About go where they say.** Documentation opens doc.xentium.org,
  GitHub opens the Xentium repository, Changelog opens its releases, and Plugin Marketplace opens
  plugins.xentium.org. They pointed at addresses that do not exist.

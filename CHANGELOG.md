# Changelog

## Security advisories in the ACP

### Added

- **The Updates page lists security advisories** that affect this site: the plugin,
  how severe it is, which versions are affected, the version that fixes it and what is
  wrong. An advisory with no fix released yet is shown too, so you know what to do in
  the meantime. Until now an advisory only marked a pending update as critical, and one
  without a fix was not shown at all. An advisory disappears as soon as the fixed version
  is installed, without waiting for the next daily check.

## Plugins can require a pre-release

### Changed

- **`minXentiumVersion` and `maxXentiumVersion` can name an exact pre-release**, such as
  `"1.0.0-alpha.11"`. Older builds then refuse to install the plugin, with a message naming
  both versions, instead of installing something that cannot work. A requirement written
  as a release line (`"1.0"`, `"1.0.0"`) means what it always did: every build of that
  line, pre-releases included. The same rule applies to themes and to the core-update
  compatibility check.

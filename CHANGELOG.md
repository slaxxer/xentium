# Changelog

## Listing screenshots, and the five official plugins get a shop front

### Added

- **A plugin can ship its own listing pictures.** `manifest.screenshots` names up to six
  images under the package's `assets/`, and the packager puts them in the archive. The
  marketplace extracts them from the artifact it is already verifying, so a shop can
  never show a screenshot of a version it is not selling — the same reason a theme's
  preview has always been extracted rather than uploaded beside it.
- **`e2e/capture-shots.mjs`** — not part of the test suite. It drives a real signed-in
  browser over a dev instance and writes the gallery images straight into each plugin's
  `assets/`, at the exact aspect ratio the storefront's frame uses.

### Changed

- **The packager fails on a screenshot it cannot find**, or one that points outside
  `assets/`, rather than quietly shipping the rest. A listing that is missing one of its
  five pictures is a packaging bug nobody notices until it is in the shop.

### Notes

- `screenshots` is storefront metadata and the host ignores it at every step — nothing in
  installing, enabling or running a plugin reads it.
- All five official plugins were repackaged with two screenshots each. The artifacts are
  still 1.0.0 and the code inside them is unchanged, but the bytes differ from the 1.0.0
  already in the catalogue, and a published version's bytes are never replaced.

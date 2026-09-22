# Changelog

## Admins hear about core updates, and we can publish one

### Added

- **Instances are told when there is a newer Xentium.** The daily marketplace sync gains a
  third, independent step that asks the marketplace what core releases exist, and the three
  surfaces that already existed for plugin updates learn about core: a card above the plugin
  list on Extensions → Updates, the ACP-entry dialog, and the navbar gear badge. The check is
  anonymous (the version we are on, and nothing else) because an install that never connected
  an account is the one most likely to be running an un-patched forum.
- **Urgency comes from the whole upgrade path, not the newest release.** An install three
  versions behind whose newest offer is a feature release may still have a security fix waiting
  in between. The card names the release the urgency comes from and quotes its notes.
- **The dialog stays restrained.** It fires for a minor, a major or anything urgent, and never
  for a plain patch on the minor you are already on. That is the most common release there is,
  and a dialog people meet weekly is a dialog people stop reading.
- **Plugin compatibility is checked before an update is offered**, against each installed
  plugin's declared version window, and the blockers are named.
- **A release workflow** (`.github/workflows/release.yml`). Pushing a `v*` tag builds
  everything, publishes `@xentium/server`, `xentium`, `create-xentium` and the framework
  packages to npm, and attaches the tarballs to a GitHub release. It can also be run from the
  Actions tab, where it defaults to a dry run.
- **`pnpm release`** (`scripts/publish-release.mjs`) publishes all four parts of a release in
  one act, since they share one version. Already-published versions are skipped rather than
  fatal, so a release that failed halfway is safe to re-run. `--only=` publishes one part,
  `--dry-run` builds and packs without publishing.

### Fixed

- **The core check only ran on the 02:30 schedule.** The boot-time check called the plugin half,
  so a site restarted right after a security release would wait up to 24 hours to be told, which
  is the case the boot check exists for.
- **The card said SECURITY above release notes about layout variants.** The badge was right and
  the page contradicted it, which teaches admins to distrust the badge.
- **The dialog printed SECURITY twice**, as the panel badge and again as a marker on its only row.
- **A dialog row is a label and a short value**, not prose: the label ellipsises and the value
  cannot shrink, so a sentence arrived as "I..". Prose moved to the note, which wraps.
- **"supports 1.0–1.0"** is a range with one member and reads like a bug. A plugin whose floor and
  ceiling are the same version now says "supports 1.0".

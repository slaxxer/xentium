# Changelog

## Core updates arrive as a dialog with the whole story

### Changed

- **A new Xentium release opens a dialog with everything in it.** The version you are on
  and the one available, when it was released, how many releases you are behind, anything
  to watch out for (a security fix on the way, a plugin that doesn't support the new
  version yet, manual steps), the changelog of every release in between, and the commands
  that install it, with a Copy button.
- **Prereleases always open the dialog.** Every alpha counted as a patch on 1.0, and patches
  on your own version line stay quiet, so an alpha was only ever announced by the badge and
  the card. They are labelled as prereleases.
- **"Got it" counts as read.** The dialog carries the same notes and commands as the Updates
  page, so reading it is enough. "Later" still brings it back on your next visit.
- **A release later marked as a security fix brings the dialog back**, even for an admin who
  had already seen it as an ordinary release.

### Fixed

- **The update command works for your site.** The ACP printed `sudo xentium update`, which
  installs npm's newest stable release, so it could never install an alpha, and it skipped
  updating the CLI first. It now prints your site's directory, `npm install xentium@<version>`
  and `npx xentium update <version>`, with the version it is offering.
- **Release notes are formatted.** They showed as raw Markdown (`## Title`, `**bold**`). They
  now render as headings, lists, code and links, in a box that scrolls on its own on the
  Updates card too.

### Upgrading

Nothing to do. There are no migrations. Update the CLI first, as the dialog now tells you.

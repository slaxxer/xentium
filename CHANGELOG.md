# Changelog

## Core updates arrive as a dialog with the whole story

### Changed

- **The breadcrumb line above ACP pages is gone** in the sidebar layout. The section panel
  and the page title already say where you are. With the panel collapsed, search is a
  magnifier in the sidebar that opens the palette in the middle of the screen (⌘K still
  works).
- **A new Xentium release is a one-time dialog with everything in it.** The version you are
  on and the one available, when it was released, how many releases you are behind,
  anything to watch out for (a security fix on the way, a plugin that doesn't support the
  new version yet, manual steps), the changelog of every release in between, and the
  commands that install it, with a Copy button. Every release opens it once per admin, and
  any way of closing it counts as seen.
- **Plugin updates join that dialog.** When plugin updates are waiting too, they are listed
  at the bottom, with a button to the Updates page, instead of a second dialog straight
  after.
- **Core releases are no longer on Extensions → Updates.** The Updates page lists plugin
  updates only; the dialog is where a new Xentium is announced.
- **The gear icon in the site's navbar shows a red dot when the ACP needs you**: a waiting
  Xentium release, a plugin update, or the licence. No count, just the dot; the core release
  keeps it lit until your site runs the new version.
- **The ACP sidebar's mark is a shield with a person**, the same staff mark the marketplace's
  ops console wears.
- **A release later marked as a security fix brings the dialog back**, even for an admin who
  had already seen it as an ordinary release.

### Fixed

- **Clicking anywhere in a tall composer starts typing.** A composer given a minimum height
  only accepted clicks on its first line, so a click in the empty space below did nothing.
  It now puts the cursor at the end of what you've written.
- **The admin menu in the sidebar opens in full.** Clicking your avatar at the foot of the
  sidebar opened the menu behind the section panel, cut off at the sidebar's edge. It now
  opens beside the avatar, over everything, and grows to fit longer labels ("Lateral ·
  Superior") instead of cutting them off, in both layouts.
- **The update command works for your site.** The ACP printed `sudo xentium update`, which
  installs npm's newest stable release, so it could never install an alpha, and it skipped
  updating the CLI first. It now prints your site's directory, `npm install xentium@<version>`
  and `npx xentium update <version>`, with the version it is offering.
- **Release notes are formatted.** They showed as raw Markdown (`## Title`, `**bold**`). They
  now render as headings, lists, code and links, in a box that scrolls on its own.

### Upgrading

Nothing to do. There are no migrations. Update the CLI first, as the dialog now tells you.

# Changelog

## A new admin panel

### Changed

- **A teal look in light and dark.** The admin panel now uses the same teal as the core look
  and the docs site, with its own light and dark palettes, calmer cards and Bricolage
  Grotesque headings. It opens in light; the toggle in the sidebar switches to dark. Group
  colours stay exactly as you set them.
- **One button size and one select.** Every button in the admin panel is the same height,
  and every dropdown has the same box, chevron and colours, in light and dark.
- **Articles.** A redesigned page with an overview (published, waiting for review, drafts,
  reads), a review queue on top when articles are waiting, search, a category filter,
  sorting, and status filters with counts, Hidden included. Each row shows the category,
  read time, Pinned, Comments closed, Members only and Hidden. Its menu pins, closes
  comments, hides, publishes or sends an article back to draft. Select several to move,
  hide or delete them at once.
- **Categories live on the Articles page.** The Categories tab holds the category tree:
  drag to reorder, add sub-categories, see how many articles each holds and open them.
  Creating and editing use a new dialog with Details and Access, where a category is
  public, members only or for chosen groups. The old Categories address takes you there.
- **Installed Plugins.** One list with search, filters, a switch per plugin and bulk
  enable, disable and remove. A details panel shows what a plugin adds, where it came
  from and its settings, and removes it with or without its data.
- **Updates.** Pending plugin updates in one list: update several at once, follow each
  one's progress in its row, and try again when one fails. "What's new" lists each
  version's changes by type (New, Improved, Fixed, Security, Breaking), and an update with
  a breaking change tells you what breaks before it runs. Check now asks the marketplace
  straight away.
- **Moderation templates.** A tab per action, templates as cards you can drag into order or
  sort by use, and an editor that shows the escalation path from warnings to bans, the
  message as the member will see it and how often the template is used. The moderation
  tools on each page list them in your order.
- **Moderation log.** Every entry reads as a sentence ("Slaxxer banned spamhost42"),
  grouped by day, with filters for the kind of action, who did it and the period, a
  search, the details one click away, seven entries a page and a CSV export.
- **Profile fields.** A new page with the fields in profile order (drag to reorder) and an
  editor for each. New per field: help text, default privacy, a minimum age at sign-up,
  a longest answer and a link prefix. New field types: Long text and Choice.
- **Badges and article categories** share a new editor dialog with a live preview.

### Fixed

- **Default user group** (Settings, Registration) lists your real groups instead of a fixed
  Member and Moderator. Groups that open the admin panel aren't offered, and the server
  refuses them.
- **Group glow.** A member's name glow is no longer cut into a box on the member page,
  the members list and the articles list.

## Legal documents

### Added

- **Choose what must be accepted.** Each document in Content, Legal has a "Must be
  accepted" switch. A document with it on is asked at sign-up, and once from every member
  who hasn't accepted it yet. Terms of Service and the Privacy Policy start switched on,
  as before.
- **Ask members to accept again.** After an important change, ask every member or only
  chosen groups to accept the new version. They are taken to the document on their next
  page, accept it at the bottom and carry on where they were going. The page shows how
  many members still have to accept.
- **Until they accept, only the basics work.** While a document waits for a member, the
  server answers their requests with an error except for signing in and out, the legal
  pages and what a page needs to display.

### Changed

- **Sign-up names every required document.** The consent box links each document that
  must be accepted, not only the terms and the privacy policy.

## Members

### Changed

- **Date of birth is required at sign-up** on new sites, and has to be a real date after
  1900 and before today. How it shows on a profile is the member's own choice in Account,
  Privacy; the admin panel no longer sets a format for it.
- **Your other profile fields show on the Information tab**, under Details.

## Layouts

### Fixed

- **Home has three columns again.** A block placed in home's old side region showed up as a
  fourth column. It moves into the right rail on its own when you update.
- **A masthead's edge art** above the navbar is no longer hidden behind the navbar.

## For plugin developers

### Added

- **Core's controls for your admin pages.** The shared `Button`, the icon picker
  (`webIconPicker`, with `registerBundledIcons` for icons your bundle carries) and the editor
  dialog (`webEditorDialog`) are available as host globals, so your pages match the panel.
- **`host.geo`** looks up a visitor's country from core's local IP database. Nothing leaves
  the server.

## Upgrading

- Three database migrations run with the update: template order, profile field settings and
  legal acceptance. Members who already accepted your terms and privacy policy keep that.
  `xentium update` takes a backup first, as always.

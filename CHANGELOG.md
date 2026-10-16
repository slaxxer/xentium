# Changelog

## Faster pages

### Changed

- **The first visit downloads a lot less.** The admin panel, the article editor and the
  installer now load only when someone opens them. A visitor's first page needs about a
  quarter less JavaScript (1.77 MB instead of 2.46 MB, 535 KB compressed) and about half
  the CSS (392 KB instead of 728 KB). Admins get the panel a moment after clicking in, the
  first time per visit.

## Fixes

### Fixed

- **Dates follow your site's time settings everywhere.** The time zone, the 12/24-hour
  clock and the date style you pick in ACP → System Settings now apply to legal pages,
  profile article dates, active sessions, the maintenance "back at" time, warnings, the
  article editor's "saved at", the ban notice and most lists in the admin panel. Before,
  those used the visitor's browser settings instead. Charts and logs keep their short
  formats.
- **The admin panel's red notice dot sits on the gear icon** in the header, where the
  dots on the other header icons sit. It was drawn above and to the right of it.

## For plugin developers

### Added

- **Embeds: show your plugin's content inside posts and articles.** A plugin can now put
  something it owns into written content, for example a poll in a post. The content
  stores a small placeholder, and wherever it is shown the plugin draws its own part.
  Plugins can add a button to the editor for it, limited to the places and members they
  choose. Core tells the plugin when the content is saved or deleted, and only shows an
  embed to someone who may see the post or article around it. The guide is
  `docs/plugin-embeds.md`.
- **`RichHtml` for drawing stored posts.** Plugins that show posts should use it instead
  of inserting the HTML themselves, so embeds inside them are drawn.

## Housekeeping

- Removed 24 unused source files, 17 of them empty placeholders.

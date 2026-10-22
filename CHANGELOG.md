# Changelog

## 1.0.0-alpha.19

### Added

- **Real page titles and preview tags.** Every page, from the home page to articles,
  profiles, the member list and your legal pages, now has its own title, description and
  canonical address in the page itself, plus the tags social networks use for link previews.
  They are written as a guest would see the page, and they follow you as you move around the
  site. `robots.txt` is served at the site's root.
- **For add-ons:** they can describe their own pages to search engines and the sitemap, take
  over search appearance as a whole, add panels to the editor next to Details, send email to
  people without an account (a support request, say), and offer edge art for part of the year.
  The developer guides cover each of these.

### Changed

- **One moderation feed, newest first.** The shield in the navbar used to list reports,
  security cases and add-on queues in separate groups, each with the oldest first. It now
  shows them together, newest on top, and every row says what it is.
- **ACP section icons** have one outline style with clearer shapes. The section you're in
  shows filled, in the rail, the top bar and the panel.
- **Dialog icons breathe.** The icon on update, announcement and alert dialogs pulses softly
  in its own colour, like the online status. Not if you prefer reduced motion.
- **Edge art shows all year.** Showing edge art only between two dates is now up to add-ons
  that offer seasonal art. Dates you set before are kept for them. Without such an add-on,
  that edge art now shows all year; remove it in Theme Studio if you only wanted it for a
  season.
- **The article editor's own search fields are gone.** How an article appears in search
  results is now up to an add-on that handles search appearance.

### Fixed

- **The article editor's byline** named whoever was editing. It now names the article's
  author, also when a moderator edits someone else's article.
- **An add-on's pages open straight away** after you enable it, instead of after a few
  minutes.

## Upgrading

- One database migration: three indexes for the member directory. On a site with a very
  large member list it takes a moment while the update runs.
- On the first start, Xentium moves the dates of seasonal edge art to where add-ons read
  them. Nothing to do on your side.

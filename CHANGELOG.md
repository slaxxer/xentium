# Changelog

## 1.0.0-alpha.19

This release fixes two security problems. Please update.

### Security

- **A member could publish another member's draft.** Anyone allowed to publish their own
  articles could publish someone else's unfinished draft by its id. Publishing is now limited
  to the article's author, or staff who may edit any article.
- **Privacy settings are now enforced by the server.** Several choices in Account → Privacy
  were only reflected in the page and not checked on the server: a members-only profile,
  who may follow you, who may post on your wall, allowing wall posts at all, and who may see
  your post history. Each is now refused on the server, and a block keeps both of you from
  following each other or posting on each other's wall. The profile page now hides what
  you're not allowed to do instead of showing a button that fails.
- **A Permissions-Policy header** switches off browser features a community site never asks
  for (camera, microphone, location, USB).

### Added

- **Real page titles and preview tags.** Every page, from the home page to articles,
  profiles, the member list and your legal pages, now has its own title, description and
  canonical address in the page itself, plus the tags social networks use for link previews.
  They are written as a guest would see the page, and they follow you as you move around the
  site. `robots.txt` is served at the site's root.
- **For add-ons:** they can describe their own pages to search engines and the sitemap, take
  over search appearance as a whole, add panels to the editor next to Details, send email to
  people without an account (a support request, say), offer edge art for part of the year,
  colour things in a member's rank colour on their profile, and build block settings with
  the site's own schema library instead of shipping their own. The developer guides cover
  each of these.

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
- **Keeping your site safe** is now part of our security policy: why to update, how backups
  and rollback work, and what an installed plugin can do on your site.
- **The article editor's own search fields are gone.** How an article appears in search
  results is now up to an add-on that handles search appearance.

### Fixed

- **The article editor's byline** named whoever was editing. It now names the article's
  author, also when a moderator edits someone else's article.
- **An add-on's pages open straight away** after you enable it, instead of after a few
  minutes.
- **More than one API process:** after the install finished, the other processes kept
  showing "not installed" until they were restarted. They now open as soon as it finishes.
- **The member directory stays fast on a big site.** It no longer counts every member on
  every page.

## Upgrading

- One database migration: three indexes for the member directory. On a site with a very
  large member list it takes a moment while the update runs.
- On the first start, Xentium moves the dates of seasonal edge art to where add-ons read
  them. Nothing to do on your side.

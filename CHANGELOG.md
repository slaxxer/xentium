# Changelog

## Theme Studio, every theme edited on its own, a dashboard that tells you what to do next, and legal documents

### Changed

- **The ACP dashboard is redesigned.** A sentence at the top says how many people joined and how
  that compares with the period before. Four tabs (new members, active members, comments,
  articles published) switch one chart, with the previous period drawn behind it. Next to it,
  **Needs attention** lists what is waiting for you, each with a button to deal with it: open
  reports, core and plugin updates (security updates first), a licence that stopped refreshing,
  recent errors, failing scheduled tasks and missing email. Below are the most read articles and
  a platform summary: version, plugins, licence, scheduled tasks, errors and every service.
- **A new site gets a setup checklist instead.** For its first 30 days, while steps are left, the
  dashboard shows what to do next (name the site, connect email, create categories, publish,
  pick a theme) and a few first milestones.
- **"Review" on open reports opens the moderation panel on the site at the report queue.**
- **ACP → Access control → Permissions is redesigned.** Pick a group from the list on the left
  and its permissions show as tiles, grouped by area, with search and filters for granted, not
  granted, sensitive and unsaved. A second view, **Matrix**, shows every permission against every
  group, one checkbox per pair; click a group's column to open it.
- **Changes wait for you to save.** Edits collect in a save bar that says what will be granted and
  revoked in which groups. Save with the button or Ctrl+S, or discard. Leaving the page with
  unsaved changes asks first.
- **Granting a sensitive permission asks first**, and says how many members it will apply to.
  Revoking never asks.
- **Copy from…** fills a group's draft with another group's permissions, to save or adjust.
- **Grant all / Revoke all** per area, in both views.
- Every core permission now has a readable name, and moderation, badges, profile walls, custom
  pages and scheduled tasks sit in their own areas instead of being named after their key.

- **ACP → System → Error log is redesigned.** The same error is one row now, with how often it
  happened, on which routes, for how many users, and a seven-day trend. Tiles at the top count
  each severity, a chart shows the last 24 hours or 7 days, and clicking a tile filters the page.
  Search finds a code, message, URL or request ID. Clicking a row opens a panel with the cause and
  fix from the error reference and every occurrence with its request details.
- **Error groups can be marked as resolved.** Resolved groups leave the default Open list and come
  back on their own if the error happens again. A group or a single entry can be deleted.

### Added

- **Implied permissions.** A stronger permission now carries the weaker one with it: editing,
  deleting or deleting comments on anyone's articles includes doing it to your own, and restoring
  article versions includes viewing the history. The server honours this in every check, and the
  ACP shows the included permission as held and locked, with what it comes from.
- **Legal documents.** ACP → Content → Legal holds your site's imprint, privacy policy, terms of
  service and disclaimer. Each one is written in the editor, saves as a draft while you type, and
  goes live when you press Publish. You can take one offline again, or throw away unpublished
  changes. A published document gets its own page (`/legal/imprint`, `/legal/privacy`,
  `/legal/terms`, `/legal/disclaimer`), showing when it was last updated, and a link in the footer.
  New permission `legal.manage`, given to administrators.
- **Registration asks for consent.** Once terms or a privacy policy is published, new members
  tick a box agreeing to the terms and confirming they have read the privacy policy.
- **Theme Studio.** The Layout Editor and the Style Editor are now one page, opened from
  Appearance → Themes with "Open in Theme Studio". It has modes for Layout, Colours & type,
  Branding, Custom CSS and History, one draft bar and one Publish that always publishes layouts
  and styles together. A scheduled publish does the same. The old editor addresses redirect.
- **Every theme keeps its own work.** Each installed theme, and the built-in Core theme, has its
  own layouts, colours, fonts, custom CSS and site layout, edited on its own. Switching themes
  only changes which one is live, so switching back brings your edits back. Updating a theme keeps
  what you customised and lets the rest follow the new version. Your existing edits are moved onto
  the theme you are wearing the first time the site starts.
- **Site layout.** Choose how the whole site sits on the page: full width, boxed, flush, framed,
  floating or overlapping the header, with box width, corners, shadow and a page background
  (colour, gradient or image). Each core page can use its own setting. Themes can ship one.
- **Edge art.** Sections, the header, the navbar, the footer and other surfaces can get a shaped
  edge (slant, wave, peaks, drips or your own image), optionally only during a season of the year.
- **A composed header.** The header holds the logo, tagline and the account, notification,
  message and search buttons in one masthead, with settings panels for the header, navbar and
  footer. Existing headers and footers are converted on first start.
- **Theme style in the block inspector.** A second inspector tab picks a colourway, corner style
  (rounded, chamfered, sharp), glow and the block's style variant. Themes can ship colourways.
- **Rank images.** A group can have a rank image, shown instead of its text badge when Settings →
  Rank display is set to images.
- **Age or birthday on profiles**, following each member's privacy choice. A date visible to
  members only is no longer shown to guests.
- **For plugin authors:** plugins can register report targets (so their content can be reported,
  inspected and removed from ModCanvas) and moderation queues that appear in the shield.

### Changed

- **The footer bar.** Legal links come first on the left, followed by your own footer links, with
  the theme picker on the right. The copyright line is now always centred underneath.
- **ModCanvas v1.** Moderation now happens on the page. A shield in the navbar (beside the bell)
  shows a red dot when something waits and lists reports and security cases together, oldest
  first. Picking a report opens the reported content, marks it, and puts an action pill at the
  bottom of the screen: Warn, Ban, Remove or Dismiss, a premade text, then Send, and on to the
  next. A security case opens on the linked profile with its accounts, signals, Allow and Ban all.
  The floating ModCanvas button and its slide-over panel are gone; user tools, the audit log and
  the case list are in the ACP.

- **Usernames show their group colour and glow everywhere**, including the home feed, search,
  the navbar, the guest landing and the ACP user lists.
- **Previous usernames** are a small dropdown beside the profile name instead of a line of text.
- **The Style Editor and Layout Editor are reached through Appearance → Themes** and no longer
  have their own menu entries.

### Removed

- **Custom pages (ACP → Content → Pages) are gone**, along with the `/p/<slug>` pages, the
  "Custom page" layout template and its per-page layouts. A page that was assigned as the site's
  terms, privacy policy or imprint becomes that legal document (and stays live if it was
  published). Any other page is deleted, as are navigation links that pointed to a page.
  `page.manage` and `page.publish` are replaced by `legal.manage`.

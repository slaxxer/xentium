# Changelog

## A finished core look

### Changed

- **A teal header band under the navigation.** The core look and Xentium Dark open
  with your site name on a teal gradient below the navigation bar. You can move or
  remove it in Theme Studio like any other block.
- **Teal everywhere.** The Xentium icon, the favicon and the app icons are teal, to match
  the core look.
- **A first visit that looks finished.** The guest landing uses your site's name, and no
  longer shows "0 online" or empty stats on a new site. Numbers appear once there is
  something to count.
- **Group colours stay the same in dark themes.** Member names keep the colours you gave
  their groups.

### Added

- **Phones and tablets.** On small screens the navigation folds into a menu button, with
  search, your links and your account inside. We went through every page on phone and
  tablet sizes and fixed whatever ran off the screen.
- **Content width.** In Theme Studio → Site frame you choose how wide pages are, and how
  wide articles and legal pages read.
- **Navigation placement.** The links in the navigation bar can sit on the left, in the
  middle or on the right, and the account menu on either side.
- **"Set up your community".** On a new site, admins see a short checklist on the home
  page: site name, email, a first category, a first article and a look. It goes away
  once everything on it is done.

## Admin panel

### Changed

- **A tidier menu.** Users and Access control are one section, **Members** (members,
  groups, permissions, progression, badges, profile fields). The editor's settings moved
  from Appearance to **Content**, next to Emojis, and are called **Editor**. Moderation
  lists Templates right after Review cases. Plugin uploads are a button on **Installed**
  instead of a menu entry. **System** shows its pages in two groups, Setup and Logs.
  Every address stays the same, so bookmarks keep working.
- **A new Editor page** (Content → Editor). The toolbar sits on top exactly as members
  get it, and ‹ › move a tool along it. Below, every tool is a tile in its group;
  clicking a tile moves it from the toolbar to the menu to off, and each group can be
  set at once. Filter by Toolbar, Menu or Off to see what is where.
- **A new Templates page** (Moderation → Templates). A board with one column per action
  (warn, ban, remove, dismiss) and one card per template, showing its text, how long it
  lasts and how often it was used. A card opens the editor in a drawer on the right;
  "+ Add" under a column starts a template of that kind.
- **The save bar never covers a page's last button.** While it is showing, every admin
  page leaves room to scroll clear of it.
- **Review cases come seven to a page**, in the order you pick.
- **Permission lists start closed.** On the Permissions page and in a group's
  permissions, each area is one line until you open it. Searching opens every match.

## Theme Studio

### Added

- **Block settings next to the page.** Click a block in the preview and its settings open
  in the left rail, with where it sits on the page, its actions and "Move to…" to put it
  somewhere else. Keyboard shortcuts move (Alt + arrows), copy (Ctrl/⌘ + D)
  and remove (Delete) blocks.
- **Simple and Advanced.** Simple shows the settings most people need. Advanced shows all
  of them. Theme Studio remembers your choice.
- **Ready-made headers and footers.** Pick a header or footer style and adjust it from
  there, instead of building one from blocks.
- **A short tour** the first time you open Theme Studio.

## Articles

### Added

- **A new article index.** The newest pinned article leads the page. You can search, and
  filter by category, tag, time and reading length, and sort by newest, most liked or
  most discussed. Every filter is part of the address, so you can link to a filtered list.
- **A side column** with your categories and how many articles each has, what is trending
  this month, and the most used tags.
- **A new article page.** A breadcrumb, a large title with its introduction and byline,
  and a wide featured image. Beside the text: a bar with like, dislike, comments, save,
  share and report that stays in view while you read; and a column with the author
  (follow them from there), "On this page" built from the article's headings, and more
  from the same category. After the text: "Did you like the article?", comments you
  can sort by popular or newest and answer directly, and "Keep reading". Staff find
  their tools (warn, pin, edit) in one Moderation menu at the top. On phones the
  actions sit in a row above the text.
- **Your heart and bookmark are remembered.** An article you liked, disliked or saved
  shows it when you open it again.
- **Pinning.** Moderators who may edit any article can pin one from the article page. The
  pinned article is the featured one on the index.

## Emojis

### Changed

- **A new Emojis page in the admin panel.** One card per category and one row per emoji,
  in the order the editor's picker shows them. Drag a row to reorder it, or drop it into
  another category to move it there (Alt + arrow keys work too). Categories can be
  renamed in place.
- **Uploading several at once is easier to check.** The shortcodes come from the file
  names, one category can be set for the whole batch, and a shortcode that is already
  taken, or used twice in the batch, is marked before anything is uploaded.

## Moderation

### Changed

- **Warnings and bans always come from a template.** A moderator picks the rule that was
  broken from your templates and the member receives that template's text, filled in
  with their name and the content it is about. There is no free text any more. The same
  offence reads the same, whoever is on duty, and every warning points to a rule you
  wrote. If you have no warning templates, the warn dialog tells moderators so, and
  admins get a link to add one.
- **The template decides how long it lasts.** Each warning template has a "Counts for"
  setting (7 days to 1 year, or never), and each ban template its ban
  length. The shipped templates start with lengths that fit them: harassment counts for
  180 days, spam and uncredited work for 90, off-topic posts for 30. The warn dialog shows
  when the warning stops counting.
- **The shipped templates are in your site's language.** Until you edit one, it follows
  the language your site is set to, in all five languages.

### Added

- **No more site-wide warning expiry.** How long a warning counts is now only the
  template's setting. On update, each warning template without its own length takes
  the value your site used (or "never", if warnings did not expire), and the switch in
  Moderation settings is gone. A member's warnings list shows each warning's own end
  date.
- **Team leads may change the length.** Two new permissions, "Change how long a warning
  counts" and "Change how long a ban lasts", let someone set another length when they
  issue one. Administrators and Supermods have them; Moderators do not. Change this in
  ACP → Permissions.

## Cookies and privacy

### Changed

- **Xentium no longer shows a cookie notice of its own.** Everything core stores is needed
  for the site to work (signing in, security, your language and theme), and that needs no
  consent. If your site uses optional cookies or loads things from other sites, install a
  consent plugin: it shows the dialog, and core asks it before anything optional runs.
- **The icon kit waits for consent.** A Font Awesome kit is loaded from another site, so it
  now loads only once a visitor agrees to external media. Without a consent plugin, the
  site uses its built-in icons.
- **The device cookie lasts one year** instead of longer.

## Fixes

### Fixed

- **Writing an article works again.** In 1.0.0-alpha.13, opening "Write article" could
  crash the editor.
- **"Body stream already read".** Some failed requests showed this message instead of the
  real error.
- **Notifications fit their text.** A short notification is no longer as wide as a long
  one, and the same message shown again counts up (×2, ×3) instead of stacking.

- **No more request floods when the server is busy.** If the site's settings could not
  be loaded (for example while the server was limiting requests), the page re-asked
  hundreds of times a second and kept itself locked out. It now waits and tries again
  every 15 seconds, and recovers on its own.
- **The search page has its own search box.** On a phone the navigation's search sits in
  the menu, so there was no way to search again from the results.
- **Legal pages on phones** have proper margins, and a document that is not published yet
  shows the normal "page not found" page.
- **Account settings on tablets** have their side margins back.

## For plugin developers

### Changed

- **`POST /moderation/warnings` and `POST /moderation/bans` take a template.** Send
  `templateId` and `target: { type, id }` (the content it is about) instead of `reason`.
  Bans take an optional `duration`, warnings an optional `expiry`; a different length than
  the template's needs the matching permission. Requests with a written reason are
  refused.
- **`WarnTemplateSelect`** (`@web/components/WarnTemplateSelect`) is the whole warn input:
  `value`/`onChange` for the template, and `expiry`/`onExpiryChange` for team leads.

### Added

- **Consent.** Declare the cookies, browser storage and outside services your plugin uses
  with `declareConsent`, and ask `hasConsent(category)` before anything optional runs. Wrap
  embeds in `ConsentGate` to show a placeholder until the visitor agrees. A consent plugin
  registers itself with `setConsentProvider`. The guide is `docs/consent.md`.
- **Site overlays.** `registerSiteOverlay` draws something above every public page, such
  as a dialog. Overlays never show inside Theme Studio's preview.

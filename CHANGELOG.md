# Changelog

## Security

### Fixed

- **Dependencies updated: no known vulnerabilities left.** We updated every dependency
  within its version range and moved a few past one: `nodemailer` 10 (address parsing and
  recipient handling) and Vitest 4 (a file read through the test runner's mocker). The
  remaining fixes are pinned for packages that only arrive through other tools (esbuild,
  mysql2, deepmerge-ts, postcss-selector-parser). `pnpm audit` reports nothing.

- **Site search works again.** Searching across the whole site failed with a server
  error, because the article and member queries still named a table from before the
  rename. A test now runs the real search queries, so this can't slip through again.

- **Imported forum posts are cleaned before they're stored.** Posts brought over by the
  migration tools skipped the cleaning a post gets when a member saves it, so a script
  link hidden in an old board's BBCode (`[URL=javascript:…]`) could survive an import.
  Every imported post now goes through the same kind of allowlist: only safe tags, and
  links only to `http`, `https` and `mailto`.

### Added

- **`SECURITY.md`:** how to report a vulnerability privately, what happens after you
  do, which versions get fixes, and what is in scope.

## Moving to Xentium

### Added

- **Migration tool for vBulletin 3, 4, 5 and 6.** `@xentium/migrate-vbulletin` connects
  to your board's database and works out which version it is. It brings over members
  (who keep their passwords), the forum tree, threads and posts with their BBCode
  converted, and ignore lists as blocks. From vBulletin 5 and 6 it also brings likes and
  member follows. As with the other tools, a dry run comes first and writes nothing.
- **Migration tool for WoltLab Suite.** `@xentium/migrate-woltlab` imports WoltLab Suite 5
  and 6 (and Burning Board 4): members, articles with their categories, and with Burning
  Board the forum, threads and posts. Reactions on posts become likes, and follows and
  ignore lists carry over. Staff are recognised by their group permissions, not by
  group names.
- **Private messages move over too.** The phpBB, XenForo, vBulletin and WoltLab tools
  bring private messages over as conversations when the messaging plugin is enabled.
  Each conversation goes only to its participants, ones a member had deleted arrive
  archived, and nothing shows up as unread. Without the plugin, everything else imports
  and the report says how many conversations are waiting.
- **More comes over from your old forum:** date of birth and website, avatars (point
  the tool at the old site's folder and Xentium's upload folder), thread tags, thread
  subscriptions for the threads that came over, bans and warnings that are still in
  force (XenForo, phpBB, vBulletin), profile
  wall posts with their replies, and comments on WoltLab articles that came over.
- **Your old links keep working.** Add `--redirects <folder>` to a migration and the
  tool writes an nginx file (plus a CSV for other web servers) that sends every old
  thread, post, board, member and article address to its new page with a permanent
  redirect. Posts open on the right page of their thread. Works for every tool,
  including WordPress permalinks.
- **Your member groups come along.** Groups beyond staff (VIP, Donors, Beta testers…)
  are recreated by name with their members, and with no permissions until you grant
  them, so nobody gains rights by accident.
- **Imported members accept your terms once.** Members who came over from another
  platform never saw your terms or privacy policy. While either is published, they're
  asked once, on their first visit, to accept them before going on; declining signs them
  out. The same goes for accounts an admin or a sign-in provider (Google, GitHub,
  Discord) created. Sign-up now records the acceptance, and refuses an account without it.
- **Last visits and smileys come along.** Each member's last visit on the old site shows
  as "Last seen" on their profile until they come back. Smiley codes in posts and
  messages (`:)`, `:D`, `:lol:` and the like) become the emoji they meant, and code and
  links are left exactly as written.
- **Thread prefixes and labels come along.** XenForo and vBulletin prefixes and WoltLab
  labels become thread prefixes, with their colour and the boards they were offered in.
- **Big boards migrate without running out of memory.** Posts, private messages and
  likes are read in pages, so a board with millions of posts needs no more memory than
  a small one, and a re-run skips what's already there a page at a time.
- **Imported posts look and edit like native ones.** Posts and private messages arrive
  in exactly the shape our editor saves, so editing an imported post changes nothing.
  Images from other sites become links, as the editor keeps no outside images in posts.
- **phpBB titles with special characters import correctly.** Topic titles and forum
  names like "Q&A" no longer arrive as "Q&amp;A".
- **Members from vBulletin and WoltLab keep their passwords.** Sign-in now understands
  their password formats, checks them once on the first login and upgrades them, like
  the other imported accounts.
- **Documentation for switching:** an honest comparison with WordPress, phpBB, XenForo,
  WoltLab Suite and vBulletin, and a page per platform on what moves over and how.

## A new default look

### Changed

- **Xentium has a new, simpler default look.** A clean light page, white cards with fine
  hairlines, a plain white header in one row (logo, links, your icons and account menu)
  and a quiet footer. Text is set in Figtree, big headlines in Bricolage Grotesque. It is
  built from the same layout blocks you can rearrange in Theme Studio, so it is a starting
  point, not a finished design. The admin panel keeps its own look.
- **One accent, everywhere: deep teal.** Buttons, links, tabs, badges, the default logo
  mark and the favicon all follow it, so changing the accent in Theme Studio recolours
  the whole site at once. Success, warning, error and info colours stay clearly apart
  from it.
- **No gradients in the default look.** Buttons, avatars, empty covers and highlights are
  flat colours, and accent buttons no longer glow. Gradients you set yourself, on a
  section, the page background or edge art, still work.
- **Xentium Dark.** Every site now comes with a dark version of the default look. Readers
  can switch to it in the theme chooser in the footer (or under Preferences), and you can
  make it the site's theme on the Themes page. It never switches on by itself. If you
  remove it, it stays removed.
- Members without a photo get a solid identity colour, the same one everywhere.
- In Theme Studio, the font list starts with **Site default (Bricolage Grotesque +
  Figtree)**, and both are available on their own too, for the site and in your profile
  settings.
- A site you have already customised keeps its own colours, layouts, frame and fonts.
  Only what you never changed follows the new defaults.

### Fixed

- Edge art pointing down out of the navbar no longer covers the site alert bar or the top
  of the page.
- Header icons carried into the navbar (moderation, notifications, messages) use the
  navbar's colours, so they stay right on a dark navbar.
- The footer's numbers, names and links follow the footer's own colours, so they stay
  readable on a dark footer.
- The footer lines up with the page: its text and divider lines start where the page
  content does, and every divider is the same width.
- Who's online lists names separated by commas, and the line under it no longer ends
  on a stray dot when it wraps.

## Profiles

### Added

- **"Last seen" on profiles.** When a member isn't online, their profile says when they
  were last here ("Last seen 3h ago", or the month for longer ago). Members can hide it
  under Account → Privacy. Admins' member list now remembers it after a member signs out
  too, instead of losing it with their sessions.

## Home

### Added

- **Save articles for later.** The Save button on a home card works now, and your saved
  articles have their own list in the home menu (**Saved**).
- **Follow categories and tags.** Star a category under "Your spaces", or pick one from an
  article's "…" menu. **Following** shows the new articles in what you follow.
- **The "…" menu on home cards:** copy the link, follow the article's category or tags,
  edit it (your own, or with permission to edit any) and report it.
- **Share** opens your device's share sheet, or copies the link where there is none.
- **Article pictures on the guest home.** An article with a featured image shows it beside
  its title in the guests' feed, as members already see it.
- **Thumbs up and thumbs down on article comments and wall comments**, in place of the
  hearts. A thumbs-up and a thumbs-down replace each other, you can't thumb your own
  comment, and the page remembers what you gave after a reload. Your thumbs-down shows
  in red; on article comments the thumbs-down also has a red outline.

### Changed

- The home menu is **Home, Following, My articles, Liked, Saved**. My articles are the
  articles you published, Liked the articles you liked. Members moved out of it (it is in
  the header).
- A heart on a home card shows whether you already liked the article. On your own article
  it shows the count only.

### Fixed

- Replacing an article's featured image shows the new picture straight away. It used to
  keep showing the old one, because the new file had the same address.

## Emojis

### Added

- **Your own emojis.** ACP → Content → **Emojis**: upload images (several at once), give
  each a `:shortcode:` and a category, rename or move them later. The editor's emoji
  picker offers exactly these, everywhere you write: articles, comments, the wall, forum
  posts and messages. Posted emojis show at text size.
- **Nine smileys to start with.** Every site begins with a Smileys set (`:happy:`, `:sad:`,
  `:laugh:` and six more) already in the picker. They are yours like any other emoji:
  rename, move or remove them, and they stay that way.
- Removing an emoji takes it out of the picker; posts that already use it keep showing it.
- A new permission, **Manage emojis** (`emoji.manage`), for who may change them.

### Changed

- The built-in unicode emoji set is gone from the editor: the picker shows the site's own
  emojis, the starting smileys plus whatever its admins upload.

## Editor

### Added

- **Drop files onto the editor.** Wherever the editor takes attachments, you can drag
  files onto it instead of using the paperclip. The editor is outlined while you drag,
  and a file it can't take (too big, or a type the site doesn't allow) is named in a
  message instead of quietly disappearing.

## Theme Studio

### Added

- **Build pages right on the page.** The Layout editor's left side is now a block
  library: drag a block straight onto the page preview, where a line shows where it will
  land, or click it to add it after the selected block. Press **+** under any block to
  mark a spot, and the next block you pick goes there.
- **Arrange on the page.** Click a block to select it: its label shows the blocks it sits
  in (click one to select it), and buttons to move it up or down, duplicate or remove it.
  Drag a block to move it; the page scrolls when you drag near its edge.
- **Layers** is the full structure list, one tab away. It still shows everything,
  including blocks you can't see on the page right now.

- **Click a real page to style it.** In Colours & type, switch the preview from
  Components to **Page** and pick one: home, articles, members, your profile or a plugin
  page. Click a button, a card, the footer or the search box and the matching settings
  open, already scoped to where you clicked. The page shows your draft and doesn't
  navigate while you click around.
- **A heading font per block.** In the Layout editor, open a block's Style panel and pick
  a Heading font: its headings (and those of the blocks inside it) use that face while
  the rest of the page keeps the site font. Pick "Site font" to go back.
- **One History for the whole theme.** Every publish is recorded with its layouts,
  colours, font and custom CSS, and a short summary of what changed. **Restore** brings an
  entry back as the draft: check it in the previews, then publish.

### Changed

- **Custom CSS and the font are part of the draft now.** They used to go live the moment
  you saved them, ahead of the colours and layouts they were written for. Now they save to
  the draft as you type and go live with the one Publish. The CSS console tells you when a
  stylesheet can't be read, instead of saving it.
- The Colours & type bar only says "Draft" when the colours or the font really differ from
  what's live, and only shows in that mode.
- **Theme changes no longer publish on a timer.** The "Publish theme changes" scheduled
  task is gone. Drafts save as you work, so a schedule could put a half-finished page live
  with nobody looking. Your theme goes live when you press Publish in Theme Studio. If you
  had the task switched on, it is removed for you on the next start.

## Profiles

### Added

- **Replies on the wall.** Every wall comment has a Reply button, and replies sit
  indented under the comment they answer. The wall's owner can reply on their own wall,
  and the person answered gets a notification.
- **Dislikes on wall comments**, beside the like. A like and a dislike replace each
  other, and you can't dislike your own comment.
- **Report and Delete on wall comments.** Members can report a comment, and the wall's
  owner, the author or a moderator can delete one. A deleted comment disappears
  completely, together with its replies.
- **Profile card on hover.** Rest the mouse on a username or an avatar anywhere on the
  site and a small card shows who that is: cover, avatar, group, member since, posts,
  followers and likes. A glance at the card doesn't count as a profile visit.
- **Online dot on the profile avatar**, green and gently breathing while the member is
  online.

### Changed

- Wall comments show the date and the time, in the site's format.
- The visitors and followers cards show faces with the total as a badge.
- The Warnings tab draws each warning and ban with one even border in its state's colour
  (an active ban in red), and names who issued it in their group colour.
- The "+ New Article" button is gone from the profile tabs.

## Notifications

### Changed

- **Every notification opens where it happened:** a wall comment or reply, an article
  comment, a warning on your Warnings tab, or the moderation shield for a new report.
  The page scrolls to that item. Older notifications are mapped to the same places.
- **Header icons show a red dot instead of a number.** The bell, shield, gear and
  plugin icons show a small breathing dot when something is new; the count is still read out by
  screen readers.
- The bell's "Mark all read" link and the dots on each entry are gone; unread entries
  stay highlighted.
- Notifications and emails arrive in the reader's language, including the ones plugins
  send.
- **Notifications from moderators are marked.** Approvals, rejections, locks and removals
  show a red shield in a red-ringed circle instead of the sender's avatar. Plugins can
  mark their own moderation notifications the same way.

## Groups

### Added

- **New sites start with group colours**: Administrator red, Supermod orange, Moderator green
  and Member grey, so each staff tier is easy to tell apart. They apply once, when the group
  is created; colours you have already picked stay as they are.
- New sites also start with the groups in rank order: Administrator, Supermod, Moderator,
  Member. A member in several groups wears the highest one's badge.

## Translations

### Fixed

- **Everything you read is in your language**, including tooltips, image descriptions and
  screen-reader labels. German, Spanish, French and Portuguese readers no longer meet English
  in the editor toolbar, block settings, access pickers, dialogs, the home card or the theme
  preview.
- File sizes follow your language too ("1,5 Mo" in French).

## Who's online

### Changed

- **The footer counts guests** and keeps a visitor record (members and guests, with the
  date it was set): "N members online · N guests · Record: …". Guests are counted by an
  anonymous hash, never their IP address, and crawlers don't count.
- The "There are N members online…" sentence is replaced by that line. Setting the
  block's "Names to show" to 0 hides the names and keeps the counts.

## Header and layout

### Changed

- **The account menu holds the header icons.** The shield, bell, plugin buttons, ACP
  link and search sit beside your avatar in one row, every item the same width.
  Existing headers are moved over automatically, in the order you had them.
- **The article editor sits inside the site** with its header, frame and footer. The
  Save/Publish bar sticks under the navbar, and the details panel docks beside the
  editor on wide screens.
- A footer whose edge art rises upward no longer covers the last card on the page.
- **The favicon matches your logo icon.** Without an uploaded favicon, the browser tab
  shows the Xentium mark in the Logo icon colours you set in Theme Studio, and follows
  them when you publish a change.
- **Site alert:** a bar under the navbar with your message, for everyone, guests or
  members, optionally dismissible. Staff browsing during maintenance see a reminder with
  a button to turn it off.

### Added

- **Style your header dropdowns.** Theme Studio → Colours & type → "Menus & dropdowns"
  sets the background, text, secondary text, border, hover, corner radius and the text
  and title weight of the account, notifications and moderation dropdowns, and of
  plugin dropdowns in the header. A new "User menu" section styles the header's icon
  bar itself: background, text, dividers, weight and corners.
- **Click the dropdowns to edit them.** In both Theme Studio previews, clicking a
  header icon opens its dropdown. In Colours & type, clicking the dropdown opens
  "Menus & dropdowns" and clicking the icon bar opens "User menu". In the layout
  editor, the selected header block shows the same settings, and the open dropdown
  updates as you edit.
- **Pick your own header icons.** The notifications, moderation and plugin header
  buttons get an Icon setting in the layout editor, like other blocks.
- **Plugins can add links to the account menu.** They appear between "Account settings"
  and "Sign out", styled like the menu's own entries.
- **Browse your Font Awesome kit in the icon picker.** With a kit set up, choose a style
  first and the picker shows every icon your kit draws in that style, with search. You
  no longer have to know an icon's name. Stylised Pro+ families like Jelly only list
  the icons they actually include.
- **Image and rich text fields in the layout editor.** Image blocks get an Upload
  button, and rich text blocks use the same editor as articles.

### Fixed

- An Image block with no picture yet no longer breaks the page, and a block that failed
  comes back as soon as its settings are fixed.
- Theme Studio's "Unpublished" count follows your edits straight away.

## Translations and email

### Changed

- **Emails go out in the recipient's language** (their account language, else the
  site's), and the shipped templates exist in all five languages. A template you edited
  is sent exactly as you wrote it.
- **Email templates are edited with the Composer** instead of raw HTML, with buttons to
  insert placeholders. Templates you saved as HTML before keep working.
- Moderation tools, permission names, the guest home, dropdowns and many shared
  components are translated, and German, Spanish, French and Portuguese gained the texts
  they were missing. Dates and numbers follow the reader's language.
- Plugins can translate the text core shows for them (menus, blocks, jobs, permissions,
  notifications). See `docs/plugin-i18n.md`.

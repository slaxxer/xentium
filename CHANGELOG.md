# Changelog

## One button height in the ACP

### Fixed

- **Every ACP button is the same height.** Buttons were sized by their padding (35.5px)
  while the save bar, review cases and the members list set their own heights (28 to
  40px), so two buttons side by side rarely matched, Discard and Save among them. In
  the ACP the height is now one token: 38px, and 28px for small buttons. Every button
  style reads it, including the save bar, review case actions, member row actions and
  confirm dialogs. Labels stay on one line.

## Permissions decide, not group names

### Changed

- **Access follows ACP → Permissions everywhere.** Pages and checks that asked "is
  this member an Administrator, Supermod or Moderator?" now ask for the permission
  the action needs, so a renamed group, a custom team group or a revoked grant
  behaves as the Permissions page shows:
  - the ACP and its link in the header: Access the admin panel;
  - the moderation shield and its queues: Handle reports or Work review cases;
  - warning an article's author, and seeing another member's Warnings tab: Warn
    members (their bans and addresses also need Ban and unban members);
  - editing someone else's article: Edit any article;
  - the edit link on legal pages: Manage legal documents;
  - error details on the error screen, and sample data in the layout preview:
    Access the admin panel;
  - who may be assigned a review case: Work review cases.

### Added

- **"Counts as staff"** (`moderation.protected`), a new Moderation permission for
  Moderators, Supermods and Administrators. Holders cannot be warned or banned, a
  case's "Ban all" skips them, sign-in guards that exempt staff exempt them, and the
  members page's Staff filter lists them.

### Fixed

- **A permission an admin takes away stays taken away.** Default grants, for core
  and plugin permissions alike, were re-applied every time the server started, so
  revoking one in ACP → Permissions lasted only until the next restart. Defaults now
  apply once, when the permission first appears. After that, the ACP alone decides.
- **Renamed system groups keep their names.** Renaming Administrator, Supermod,
  Moderator or Member was undone at the next restart.
- **The Permissions page shows a plugin's own label** for its permissions instead of
  one made up from the key.

### Added

- **The browser knows what the signed-in member may do.** `/auth/me` now returns the
  member's effective permissions, so pages can offer a tool based on the permission
  its endpoint checks rather than on group names. Every endpoint still checks for
  itself.

## Plugins can ask about permissions

### Added

- **`host.permissions.has(userId, key)`** for plugins: whether a member holds a
  permission, the same answer `requirePermission` acts on, without refusing the
  request. A plugin uses it to decide, for example to let the moderators who closed
  something keep replying to it. Optional on the host, so a plugin checks for it.

## Posts keep their formatting

### Fixed

- **What you format is what gets posted.** Text alignment (left, centre, right,
  justify), subscript and superscript, task lists and @mentions looked right in the
  editor but were stripped when a post, message or comment was saved. The server now
  keeps exactly what the editor produces, and still removes anything else (only
  `text-align` is allowed as a style, and a stored checkbox is always read-only).
  Posts saved before this fix stay as they were stored.
- **Alignment belongs to one paragraph.** Pressing Enter at the end of an aligned
  paragraph used to start the next one with the same alignment, and every following
  line inherited it. A new paragraph now starts at the default, so each paragraph can
  be aligned on its own. Splitting a paragraph in the middle keeps its alignment on
  both halves.
- **Editor menus are never cut off.** The block picker, More tools, link and emoji
  menus are drawn on top of the page and placed by their button, so a card or box
  around the editor can no longer clip them. They open upwards, downwards when there
  is no room above, and stay inside the window.
- **Preview can show the real thing.** The editor takes a `renderPreview` option (also
  through `MiniEditor`): a surface that passes it decides what Preview shows, for
  example the whole post card as it will look once posted. Without it, Preview shows
  the formatted text as before, now in the same styles as posted text.
- **Posted text looks like it did in the editor.** Posts, messages, comments and
  articles share the editor's own styles for headings, lists, task lists, quotes, code,
  highlights and mentions (the `xt-rich` class).
- The gap between the header and the page is now the `--main-gap` token on
  `.app-main`, so a page bar can sit flush under the header (cancel it above, give it
  back below).
- **@mentions in articles show.** The article page dropped a mention written in the
  body; it now shows the link.

## Dates with times, in the site's time zone and format

### Added

- **Times next to dates.** Articles show when they were published to the minute, and
  comments read "Today, 14:05", "Yesterday, 18:40" or "7 Oct 2026, 14:05".
- **Choose how time reads on the site.** ACP, System Settings, General now has a Time
  format (follow the language, 24-hour or 12-hour) and a Date format (7 Oct 2026,
  7 October 2026, numeric, or 2026-10-07) beside the Time zone, which now also offers
  "Each visitor's own time zone". The time zone setting existed before but nothing on
  the site used it; now it does.
- **Plugins write times the same way.** The formatter is available to plugins as the
  `webDateTime` host global, so a plugin's posts and messages follow the same settings.

## Icon size

### Added

- **Bigger (or smaller) icons without bigger text.** Theme Studio, Colours & type has
  an Icon size control under Typography, from 70% to 200%. It scales every icon on the
  site, FontAwesome kit icons included, and leaves the text size alone. Like a colour,
  it is saved as a draft, published with the theme and kept per theme. The admin panel
  keeps its own icon sizes.
- **Register and Sign in are icons** in the header for visitors who are not signed in
  (a user-plus and a sign-in arrow), matching the icons members see there. Hovering
  shows the name; screen readers read it.

## A Warnings tab on profiles

### Added

- **Members can see their own standing.** A new Warnings tab on the profile lists a
  member's warnings (active, expired and pardoned), who issued each and when it stops
  counting, and the site's warning rules ("at 3 warnings, a 7-day ban"). Only the
  member and the moderation team (moderators, supermods, admins) see the tab; for
  everyone else it does not exist, and the server refuses them too.
- **A heads-up before the next sanction.** When the next warning would trigger a ban
  under the warning rules, the tab says so ("One more warning and you'll be
  sanctioned: a 7-day ban").
- **More for the moderation team.** On the same tab, staff also see the member's bans
  and the IP addresses they used: when, how often, how many other accounts used the
  same address, and the country each address belongs to.
- **IP countries are looked up on your server.** A new scheduled task, IP country
  database, downloads DB-IP's free country database once a month (Run now fetches it
  immediately). No IP address is ever sent anywhere to be looked up.

## Chamfered profile cards

### Fixed

- **Profiles with chamfered corners look right.** With Theme style, Corners set to
  Chamfered, the profile card cut the member's avatar in half and left a notch where
  the card met the cover. The cover and the card are now one chamfered shape: the cut
  at the top right of the cover, the one at the bottom left of the card, and the avatar
  whole. Rounded and Sharp corners are unchanged.
- On a profile, the member's name and the Follow / message / block buttons now sit on
  one line. The buttons used to ride higher than the name.

## One switch everywhere

### Changed

- **Every on/off switch now looks the same**, in the admin panel and on the site: the
  toggle the Progression page already used, in the accent colour when on and muted
  when off. That covers settings pages, the account settings, block settings, the
  Permissions tiles, Navigation and plugin settings. Being an icon, it follows your
  FontAwesome kit and icon style like every other icon.
- The notification button uses the solid FontAwesome bell (`fa-solid fa-bell`) instead
  of a hand-drawn outline, so it matches the other header icons and follows your icon kit.
- Plugins built before this change still get the new look: the older switch markup
  they draw is restyled to match.

## Member-only header buttons and pages stay hidden from guests

### Fixed

- **Guests no longer see members' header buttons.** A plugin's header widget (for
  example an inbox button) showed in the header for signed-out visitors. Header widgets
  are now drawn for signed-in members only, wherever an admin placed them.
- **Plugin pages can be members-only.** A plugin can mark a page `requiresAuth`. A
  guest who opens it is sent to sign in and brought back afterwards, instead of
  landing on a page that cannot work for them.

## The Xentium icon ships with every install

### Added

- **Every install now has the Xentium icon** as its default logo and favicon: in the
  header, on the sign-in, maintenance and 404 pages, as the browser tab icon, the home
  screen icon on phones, and in the ACP and the installer. Upload your own logo or
  favicon under Theme Studio, Branding and it replaces the default (the ACP and the
  installer keep the Xentium icon).
- **Style the logo icon.** Theme Studio, Colours & type has a new Logo icon group: the
  icon box's colours (start and end of its gradient; the same colour twice makes it
  flat), and a border and a shadow that follow the logo's shape. Border and shadow are
  off (transparent) until you pick a colour; the box colours start as Xentium's own.
  The ACP and the installer always keep the original icon colours.

### Changed

- **Theme Studio, Branding is redesigned.** A preview shows your brand where people
  meet it: the header in your site's own colours, a browser tab and a phone's home
  screen, including any logo icon colours you have staged. Beside it are the logo
  text, the header logo and the favicon. Each says whether it is your upload or the
  Xentium default, with Upload, Replace and Remove, and takes a dropped file. A link
  opens the logo icon colours in Colours & type. The FontAwesome kit and icon style
  sit in their own Icons card.

### Fixed

- An uploaded favicon now replaces the default in every browser. Before, a browser that
  prefers SVG icons could keep showing the old one.

## The Error Reference, redesigned

### Changed

- **Look up a code and see what happened.** ACP → System → Error Reference takes the
  code a member sent you and, if you like, their username. You get what the code
  means, its likely cause and how to fix it, with a button to each ACP page the fix
  names. Below that is what the server logged for that code in the last seven days:
  that member's occurrences or everyone's, each with its request and context.
- **Help while you type.** Matching codes are suggested as you type. With nothing
  typed, the codes logged most recently are listed, since that is usually the one.
  A code we do not know says so and suggests the nearest ones.
- **Error log links.** "All entries by …" opens the error log filtered to that
  member, shown as a chip you can remove. The error log also accepts a search from
  the link.

## Sign in and registration, redesigned

### Changed

- **Sign in where you are.** The header's Sign in opens a compact form under the
  button: passkey, Google, GitHub and Discord, or email and password, with the login
  PIN step if the account has one. You stay on the page you were reading. "Create an
  account" and "Email a link" sit at the bottom of it.
- **The sign-in and registration pages wear the site.** One centred card on a band in
  the masthead's own colours and logo, with who is online, how many members there are
  and who joined this week. The corner offers the other door ("Already a member?" or
  "New here?"), and the footer carries the language picker and the published legal
  pages. Registration keeps its three steps: account, security, verify.
- A wrong email or password now marks both fields as well as saying so.

## The Activity Log, redesigned

### Changed

- **ACP → System → Activity Log reads like a timeline.** Entries are grouped by day,
  a run of entries by one person names them once, and three or more page views in a
  row fold into one "Browsed 6 pages" line with the trail, which opens in place.
- **Actions read as sentences.** "Banned @spamlord", "Changed permissions for Moderator",
  "Sent a test email", with the method and the path underneath and the result
  as a coloured status. Users and groups are named, not shown as ids.
- **A failed action says why**, in red beside it ("SMTP connection refused"). This is
  recorded from now on; older failures show only their status.
- **Filter by anything.** Tabs for all activity, ACP actions and movements show their
  counts; search covers paths and people; menus filter by user, time, method, result
  and IP. Each entry shows the person's IP and browser.

## Create users from the ACP

### Added

- **ACP → Users → Create user.** An admin can make an account without going through
  sign-up: username, email, password (type one or generate one), an optional display name,
  a group (the default group unless you pick one), and whether the email counts as
  verified. It follows the same rules as registration, refuses a taken email or username,
  and opens the new member's page when done.

## The Themes page, redesigned

### Changed

- **ACP → Appearance → Themes shows what is live first.** The live theme sits on top,
  drawn in its own colours, with when it was installed and last edited, its palette, and
  View my site, Edit in Theme Studio and Undo. Every other theme, Core included, is a card
  in the library below, also drawn in its own colours.
- **Colour variants are one click.** A theme's colourways show as chips: pick one to
  preview it, then make it live. A library card can switch straight to a theme in the
  variant you picked. Both are undone by Undo, like a theme switch, and say so in a toast
  with an Undo button.
- **Removing a theme asks on its card** instead of in a dialog. Undoing a switch no longer
  asks at all: it loses nothing. Undoing a theme update still asks, because it can.
- **Install theme** moved into the page header beside Export, and the Marketplace link
  opens the marketplace on its themes.

## The ACP save bar

### Changed

- **Nothing in the ACP goes live until you save.** Settings pages no longer save as you
  type. One save bar at the bottom of the screen appears as soon as anything on the page
  changes, counts the changes across every panel, and lets you review, revert, discard or
  save them together (⌘S / Ctrl+S). Leaving the page with unsaved changes asks first, in
  the bar. A failed save says which setting and why, and takes you to it.
- **System Settings shows what changed:** a dot on each section with unsaved changes, and
  under each changed setting what is live right now, with a Revert.
- **Plugin settings join the bar** with no update needed: the autosave hook plugins use
  now registers with it. Theme Studio and legal documents still autosave their drafts,
  since they have their own Publish.
- Editing several email templates or moderation templates keeps every edit when you
  switch between them, and saves them together.

## Edge art, colourways and the moderation tool

### Added

- **Three new edge-art shapes.** Curve, zigzag and scallops join slant, wave, peaks, drips and
  image. Repeating shapes take a repeat count, and every edge can have an opacity and its own
  height on phones (0 hides it there). Edges saved before these options look exactly as they did.
- **Plugins can extend edge art.** A plugin can register its own shapes, keep its own settings
  on an edge, draw an edge itself and add sections to the Edge art panel. While the plugin is
  off its edges are kept and draw a core stand-in shape, or nothing. Plugin art that needs no
  outline works on an edge with no shape: picking None keeps it. Edge art that follows the
  time of day gets a "Viewing at" hour picker in the editor's preview. See
  `docs/plugin-edge-art.md`.
- **Visitors can pick a theme's colourway.** A theme that ships more than one colourway lists
  them in the footer theme chooser; the pick is remembered per browser.
- **The moderation shield is its own header block.** It used to be drawn inside the notification
  bell. Existing headers get one placed just before their bell.

### Changed

- **Edge art stays for visitors who prefer reduced motion.** It used to disappear entirely. It is
  still hidden in high contrast mode.

### Fixed

- **The editor's "Viewing on" date follows the season.** After the season changed, the button
  showed the new opening day while the preview stayed on the old one.

- **`xentium update` no longer refuses a newer prerelease.** It compared the prerelease part as
  text, so `1.0.0-alpha.10` looked older than `1.0.0-alpha.9`. Numbers in a prerelease now
  compare as numbers.
- **The links on ACP → System → About go where they say.** Documentation opens doc.xentium.org,
  GitHub opens the Xentium repository, Changelog opens its releases, and Plugin Marketplace opens
  plugins.xentium.org. They pointed at addresses that do not exist.

# Changelog

## 1.0.0-alpha.20

This is the last alpha. The next release is the first release candidate for 1.0.0. It also
fixes a security problem, so please update, and update Node too (see Security).

### Security

- **Compressed request bodies are refused.** Xentium no longer accepts request bodies sent
  compressed, which shields your site from a Node.js bug that could run code on the server
  (CVE-2026-111497). Please also update Node to 22.23.4 or 24.22.1 or newer. The installer
  and `xentium doctor` now warn when your Node is older.
- **The reset form no longer gives away who has an account when mail fails.** If the mail
  server couldn't be reached, asking for a password reset or a sign-in link showed an error
  only for addresses that have an account. It now answers the same way for every address,
  and the failure goes to the server log.
- **Uploaded images lose their camera data.** Images are now re-encoded on upload, without
  the camera details and GPS location a photo can carry.

### Added

- **Build pages from sections in Theme Studio.** Pick a ready-made section (a hero, three
  features, text, a call to action, or empty columns), drag it onto the page, and change its
  columns with one click. Changing the columns never removes a block.
- **Dragging shows every place a block can go**, and the nearest one is marked, so you can
  see where it will land before you let go.
- **Type on the page.** Double-click a heading or the hero text and type over it.
- **Edge art on cards.** The home page cards (your card, spaces, hot threads, popular tags,
  suggested people, rank progress), the profile panels (rank, badges, followers, visitors)
  and the members page cards take edge art now, like sections and the header. On a card
  whose corners the theme cuts, a new edge starts inward, since the cut hides anything
  outside the card.
- **See what you changed.** The changes button counts what publishing would change and marks
  every new, edited or moved block on the page. A block you removed can be put back.
- **A new look for every email.** Your name and the message's heading sit on a band in your
  accent colour, buttons span the card, and small print sits in smaller type under the
  message.
- **The password reset email says who asked:** the time, the browser and system, and the
  country it came from, with a "contact support" link for anyone who didn't ask.
- **Design your emails** in ACP → Email → Design: the accent colour, the page colour, a
  header with your icon or logo, where "contact support" points (a web page or an email
  address), and a footer note you write with the editor (bold, links, lists), with a live
  preview.
- **Members can switch off notifications from each add-on**, in the app and by email.
- **For add-ons:** they can react to what happens on your site and refuse sign-ups,
  articles, comments and notifications; run background work once, at a time or on a
  schedule (listed in Scheduled Tasks); declare settings that Xentium stores, checks and
  draws an ACP page for; describe a table and get its endpoints; store files and images in
  the sizes they need; add fields to the sign-up form; put their settings on the blocks
  they belong to in Theme Studio; and use a shared cache and rate limits. `pnpm plugin:new` starts a working plugin, and the new plugin platform guide
  covers all of it.

### Changed

- **Theme Studio settings have their own pane** on the right. With nothing selected it shows
  the theme's colours and fonts. The desktop preview always shows the desktop layout, and
  Theme Studio folds the ACP menu to its icons to give the page more room.
- **Emails are teal** by default instead of purple.
- **After an update, Migration History shows one line** with the way back, instead of every
  step.
- **The edge art editor tells add-ons which side** you're editing.

### Fixed

- **Emails were hard to read in dark-mode mail apps** (iCloud, Gmail, Outlook). They now
  bring their own background, and show your site's icon beside its name.
- **Rolling back an update from the ACP** showed an error and needed a reload. It now runs
  in the update window, step by step.
- **The update dialog could miss its Update now button.** It now waits for the updater, and
  says why when updating from the ACP isn't set up.
- **Undo and redo in Theme Studio** couldn't be clicked: the page picker beside them
  reached over them. They work again.
- **In the Floating page layout** a banner in the header stuck to the top with the navbar.
  Now only the navbar sticks.

## Upgrading

- Update Node to 22.23.4 or 24.22.1 or newer, before or after updating Xentium.
- One database migration: a table for files that add-ons store. It runs with the update.
- Xentium now uses `sharp` for images. It installs with the update; on most servers there
  is nothing to do.

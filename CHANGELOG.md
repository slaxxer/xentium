# Changelog

## A new way in: passkeys, sign-in links, Google, GitHub and Discord

### Added

- **A new sign-in and registration page.** One page for everyone who is not signed in yet:
  a welcome side about your community (members online, member count, who joined this
  week) and a card with the form. Sign in, the three steps of creating an account, the
  login PIN step, invite-only registration, forgot and reset password all live in it, in
  your site's theme, with a language menu.
- **Passkeys.** Members can sign in with Face ID, Touch ID, Windows Hello or a security
  key. They add one in Account → Security or while creating their account, and can rename
  or remove it. Passkeys need your site on https.
- **Sign-in links.** "Email me a link" sends a one-time link that works for 15 minutes.
  Opening it asks for one click, so mail scanners cannot use it up.
- **Sign in with Google, GitHub or Discord.** Set each up under ACP → Settings → Login with
  your app's client ID and secret; the panel shows the callback URL to register. A provider
  address that already belongs to a member is never connected automatically: they sign in
  and connect it from their account settings.
- **Keep me signed in.** Unticked, the session ends when the browser closes (or 12 hours
  after it was last used); ticked, it lasts 30 days as before.
- **Account → Security** lists passkeys and connected accounts. Members who joined through
  a provider can set a password with an emailed link.

### Security

- A login PIN is asked for after a sign-in link or a provider too, not only after a
  password. A passkey unlocked with biometrics or the device PIN counts as two steps.
- No member can remove their last way to sign in.
- Provider sign-ins are bound to the browser that started them, so nobody can make your
  browser sign in to their account.

## Groups: one precedence list, and a page per group

### Changed

- **ACP → Users → Groups is one precedence list.** The group at the top is the badge a
  member of several groups wears, so the order is the point of the page: drag a row to
  change it, or focus its handle and press Alt+↑/↓. Each row shows the badge, the
  members and a power meter read from the keys the group actually holds (full control,
  elevated, trusted, standard), with a filter and totals across the top.
- **Every group has its own page** instead of four dialogs: identity and badge (name,
  label, colour, username glow, team page, icon, a live preview), permissions grouped by
  area with the sensitive ones marked, progression, and members. Identity, permissions
  and progression save as you go, with one indicator for the whole page.
- **Plugin panels are tabs of that page.** A plugin's group settings (the forum's
  progression, the shoutbox's limits) appear beside core's own, say which plugin they
  come from, and report into the same save indicator.
- **Members can be managed from the group**: search and add a member, or remove one,
  without leaving the page. Their other groups are kept.
- **Creating a group** asks for a name and a key and takes you to the new group's page.

### Fixed

- **Saving a group's permissions no longer reverts grants made elsewhere.** The page used
  to replace the whole set with the copy it loaded, so a key granted meanwhile, by another
  admin or a plugin's defaults, was silently revoked on the next click. It now sends only
  what changed.
- **A group icon can be removed**, and a replaced icon no longer leaves the old file
  behind. Icons are stored under the type read from the file itself, not its name.

## Migration History, redesigned, and imports you can watch

### Added

- **ACP → System → Migration History is a list and a detail view.** Search runs (the logs
  too), filter by core or imports and by status, runs grouped by day. The detail shows what
  ran, how long it took and what came of it, and a log viewer that colours errors and
  warnings, folds tooling noise, searches, copies, downloads and goes full screen.
- **A strip across the top** with the last schema deploy, the schema itself, platform imports
  and anything that needs attention. The schema figure is read live, the migrations this
  build ships against what your database has applied.
- **`xentium update` records its schema deploys.** An update that applies migrations now adds
  a row to Migration History, with its log and the release it deployed, and the page offers
  `xentium update <version>` as its command. A failed deploy is recorded after the automatic
  restore, and an update that migrated but was rolled back because the new release did not
  come up is recorded as failed, saying whether the database was restored. An update with
  nothing to apply records nothing. If the row cannot be written, the update carries on.
- **Imports you can watch.** A running import shows progress for each kind of record, its log
  as it is written and the issues so far, refreshing every two seconds.
- **A failed deploy tells you what to do.** It names the migration that failed, quotes the
  database's error with a link to the line, and gives you the command to mark it rolled back.
- **Commands to copy.** An import offers its own dry-run and re-run commands. Connection
  strings are never stored, so they come back as `…` for you to fill in.

### Fixed

- **Failed schema deploys are recorded.** Until now only successful ones were, so the history
  could never show a failure.
- **A run is no longer called failed because its log says "error".** The page used to guess,
  and a migration with "error" in its name (the error-log tables) made a good deploy read as
  failed. It now trusts the stored status.
- **An import that dies says so.** A run that stops writing its heartbeat for two minutes is
  shown as not responding instead of running forever.

## Announcements are a dialog again, and leave nothing behind

### Changed

- **Announcements from the Xentium team open as a dialog again** when you enter the ACP,
  instead of a band across the top of the page. One at a time, the most urgent first, with a
  single OK button. They come before licence and update dialogs, as they did before.
- **Reading an announcement removes it from your site.** The first admin to click OK has read
  it for everyone: it is deleted from your server and nobody else on the site sees it. Your
  site keeps no copy, no history and no record of who read what. The only thing left is the
  notice's id, so the next daily check does not bring it back, and that is dropped as soon as
  we stop serving the notice.

### Removed

- **ACP → Announcements.** With nothing kept, there is nothing to list.
- **The per-admin read log.** The `xcf_announcement_acks` table is dropped by a migration.

## Upgrading

Nothing to do. Migrations run on update: they drop the announcement read log, add the
column a running import keeps its progress in, and add the tables for passkeys, linked
sign-in providers and "keep me signed in". Passkeys switch themselves on when your site's
APP_URL is https; providers stay off until you configure them. Any announcement that is still
current will show once more, to the first admin who enters the ACP, and is then gone.

Imports started with an older migrate tool still appear, but without a live view or
commands to copy: those runs never recorded them.

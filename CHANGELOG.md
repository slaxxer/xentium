# Changelog

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

Nothing to do. Two migrations run on update: one drops the announcement read log, the other
adds the column a running import keeps its progress in. Any announcement that is still
current will show once more, to the first admin who enters the ACP, and is then gone.

Imports started with an older migrate tool still appear, but without a live view or
commands to copy: those runs never recorded them.

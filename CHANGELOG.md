# Changelog

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

### Upgrading

Nothing to do. The migration drops the table on update. Any announcement that is still
current will show once more, to the first admin who enters the ACP, and is then gone.

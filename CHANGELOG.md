# Changelog

## Update from the ACP

### Added

- **Update now.** When a new Xentium is out, the update dialog and **System → Migration
  History** offer an **Update now** button. You confirm with your password, and the dialog
  shows the update as it happens: each package as it downloads, every step, each database
  migration and the restart. You can close it at any time; the update carries on, and
  Migration History shows the same view, live, to every admin allowed to update.
- **Rolled back by itself when something fails.** The database backup is restored and the
  previous release runs again. Migration History then shows what failed, with the log.
- **Roll back** a finished update from Migration History, back to the release it replaced.
- **A new permission**, "Update Xentium from the ACP", under System. Administrators get it.

### How it stays safe

- The ACP never runs anything on your server. **Update now** only writes a request, and the
  updater, a small service on your server, does the work as your site's user.
- The updater installs nothing but a newer Xentium release whose npm provenance shows we built
  it, and it checks every downloaded package against its published checksum.

### Changed

- **The installed version in the footer**, after "Powered by Xentium Community".

### Fixed

- **Staying signed in during a restart.** A token refresh that reached the server while it
  restarted used to sign you out in the browser. Now only a refused refresh signs you out.

## Upgrading

- No database migrations this time.
- To update from the ACP from now on, run this once in your site's directory after updating:

  ```bash
  npx xentium install-service
  ```

  It installs the updater next to your site's services. Without it, the update dialog keeps
  showing the commands to run yourself.

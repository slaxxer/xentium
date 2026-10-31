## 1.0.0-rc.2

The second release candidate for 1.0.0: fixes only, one of them for security. Please
update.

### Security

- **The request log no longer records sign-in tokens or cookies.** In production every
  request's `Authorization` header and cookies were written to the server log, the
  30-day sign-in cookie among them. Anyone who can read your server's logs could have
  used one to sign in as that person. They now appear as `[redacted]`. See Upgrading for
  clearing what is already in the log.

### Fixed

- **Updating a plugin by uploading it.** Uploading a newer build of an installed plugin
  was refused with "uninstall it first", and uninstalling removes the plugin's data. Now
  the upload offers "Update to v…": its data and settings stay, only its new migrations
  run, and it stays switched on or off as it was. The same or an older version is still
  refused, because updates only go forward.
- **The gear in the site's header shows a dot for add-ons too.** When an add-on puts a
  count beside one of its ACP pages (an order waiting for a payment check, say), the gear
  now shows its dot as well, not only the ACP menu.
- **Plugins load the same shared packages as the site after an update.** Plugins kept
  using `express` and the other shared packages from the version the site was first
  installed with. They now follow the running version.
- **The installer's server check** no longer says sudo will ask for a password when it
  won't, or that nginx is missing when it is installed.

## Upgrading

- Update from the ACP or run `npx xentium update 1.0.0-rc.2` in your site's folder.
  No database changes.
- To clear sign-in data the server log already holds: on a server with systemd, run
  `sudo journalctl --rotate && sudo journalctl --vacuum-time=1s` after updating. That
  removes the whole system journal, not only Xentium's.

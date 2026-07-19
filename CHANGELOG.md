# Changelog

## License-expiry dialog + accurate update alerts

**License-expiry dialog (ACP).** A per-admin dialog now warns when the license is
within 30 days of expiry or has expired — showing the domain, expiry date, days
remaining, and a renewal note, with a shortcut to the License page. Like the
plugin-update dialog it persists until this admin has actually looked at the
License page (not merely dismissed it), and it re-warns each renewal cycle. At
most one dialog appears per ACP entry, with the license taking priority over
pending plugin updates.

**Fix — no more phantom update alerts.** The "update available" banner, dialog,
and navbar badge are now reconciled against what's actually installed. Previously
they read a cache that's only refreshed periodically, so a plugin uninstalled (or
already updated) since the last check could keep showing an update that no longer
applies. An update now surfaces only while its plugin is installed and genuinely
older than the offered version.

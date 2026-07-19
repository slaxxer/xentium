# Changelog

## Plugin updates: per-admin dialog that persists until you've looked, and a check on worker boot

- **The update dialog is now per-admin and sticky until acted on.** Instead of a
  per-browser "seen" flag that a bare reload or a "Later" click could silence, the
  dialog now shows on every ACP entry until *that admin* has actually visited the
  Updates page. Acknowledgement is the visit itself — dismissing the dialog never
  counts. It's tracked server-side, so it follows the admin across devices, and a
  new plugin update makes it reappear.
- **ACP movements are now recorded in the activity log.** Admin page navigations are
  logged alongside public-site movements (previously only ACP *actions* — mutations —
  were kept), giving a real admin movement trail. This is what the update dialog reads
  to know whether you've been to the Updates page.
- **The worker runs a marketplace update check on boot.** A critical plugin patch now
  surfaces right after a worker restart instead of waiting up to ~24h for the next
  daily run. Best-effort and non-blocking, and it honours the ACP → Scheduled Tasks
  toggle — if update-checking is disabled, the boot check is skipped too.

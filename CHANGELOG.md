# Changelog

## Plugin updates: a dedicated Updates page and one-click update-in-place

- **The bug**: the critical-update panel dialog marked itself "seen" the moment it
  rendered — a bare page reload counted as acknowledgement, so a critical patch could
  slip past an admin who never clicked anything. The "seen" set is now recorded only when
  the admin acts on the dialog (View or Later), so it re-appears on every ACP entry until
  they do.
- **New Extensions → Updates page**: lists every pending plugin update (critical first)
  with its changelog, the installed → latest versions, and a renewal warning where the
  license term has lapsed. The update dialog's "View updates" now leads here.
- **Persistent reminder banner** across the whole Extensions section (Marketplace,
  Installed, Upload, License) — styled for urgency when any update is critical, and
  visible for as long as updates are pending, so a dismissed dialog can't hide one.
- **Update-in-place**: each update can be applied with one click. The server re-authorizes
  the download at the marketplace chokepoint, fetches and sha256-verifies the new package,
  then swaps it in — running only the migrations that plugin has never applied, and
  preserving the plugin's enabled state and data. Updates are forward-only; nothing is
  ever rolled back.
- New error-reference entries for the two new conditions (plugin not installed; update
  package not newer than what's installed).

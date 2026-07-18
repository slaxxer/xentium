# Changelog

## Core: announcement panel dialog — plugin updates now use it

- **New reusable alert surface: `openPanelDialog`** (`@web/lib/dialog`, host global for
  plugins too) — the app-wide "something needs your attention" popup, same family as the
  uninstall confirm: wide left-aligned layout, icon, optional danger badge, structured
  detail rows (label / marker / value), warn-toned footer note, primary + dismiss actions,
  Escape/Enter, one-at-a-time.
- **The plugin-update notice is its first user**, replacing the toast: entering the ACP
  with updates waiting opens the panel once per update set — per-plugin rows show
  "Forum 1.0.3 → 1.0.4" (the update-check job now caches display names and installed
  versions), critical updates get the badge + per-row markers and sort first, a renewal
  note appears when downloads need a renewed term, and "View updates" jumps to the
  Marketplace. Dismissing stays silent until a genuinely new update appears.
- The `update` accent (dialog + toast category) themes via the Style Editor's Update slot.
  Marketplace banner shows the same enriched names/versions. All five locales updated.

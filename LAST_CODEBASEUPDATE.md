# Last codebase update — 2026-08-25

**The maintenance screen + its ACP editor, rebuilt from the canvas** in
`nodevo-redesign/Maintenance page redesign`. The public screen went from a split
"colour panel + permanent login form" to a centred status card (countdown, named
steps, affected services, follow-us links, staff sign-in in a dialog); ACP →
System → Settings → Maintenance mode grew the editor those features need.
Verified in the browser in both themes: steps and bar modes, both
backgrounds, the sign-in dialog and its error path, and auto-refresh actually
bringing the page back on its own when maintenance ended.

## New

| File | Purpose |
|---|---|
| `apps/web/src/features/admin/pages/MaintenanceSettings.tsx` | The Maintenance-mode card body: master-switch banner, grouped rows, and the three repeating editors (steps, services, links) plus the background picker. Writes into the Settings page's own draft, so it autosaves with every other section and reports into the one SaveChip. |

## Changed

| File | Purpose |
|---|---|
| `apps/api/src/modules/maintenance/maintenance.service.ts` | Status document extended: progress `mode`/`steps`/`currentStep`, `countdown`, `autoRefresh`, `background`, `services`, `links`, `staffLink`. Settings are free-form JSON and this endpoint is public, so every structured value is re-checked on the way out — bounded lists, a fixed icon vocabulary, `http(s)`-only link URLs. |
| `apps/web/src/features/maintenance/MaintenancePage.tsx` | Rewritten as the status card. Staff sign-in (with the PIN step) moved into a dialog; a locked-out account still gets the link even when the footer link is hidden. |
| `apps/web/src/features/maintenance/MaintenancePage.scss` | Rewritten. Every hex in the canvas mapped to a `--c-*` token, so the screen themes in light as well as dark and both backgrounds follow the site's accents. |
| `apps/web/src/features/maintenance/useMaintenance.ts` | Status types; the poll interval now follows the data — 30s while the site is up, 10s while the screen is showing with auto-refresh on, and off when the admin turned auto-refresh off. |
| `apps/web/src/features/admin/pages/SettingsPage.tsx` | A section may now supply its own body (`custom`) with an explicit `keys` list, so the page-wide autosave still covers it. Maintenance is the first; new defaults added. |
| `apps/web/src/features/admin/pages/acpSystem.scss` | The card's styles: group headings, master banner, live/offline pill, chips, segmented picker, list editors, status chips, background picker. |
| `apps/web/public/locales/en/common.json` | Maintenance screen copy — countdown units, step states, service states, footer. Dropped `remaining`/`backOnline` (no longer rendered). |
| `apps/web/public/locales/en/acp.json` | New `settings.maintenance.*` block; the old generic `settings.fields.maintenance*` / `placeholders.maintenance*` entries removed with the rows that used them. |

## Notes

- `maintenance.progress_mode` defaults to `bar` so existing installs are
  unchanged: a bar that shows only above 0%. Steps are opt-in.
- Only `en` was touched — de/es/fr/pt carry no maintenance or settings-field
  keys and fall back to English.
- The dev instance's maintenance settings were seeded during verification and
  restored to defaults afterwards; maintenance is off.

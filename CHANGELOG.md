# Changelog

## ACP: plugin-update toast + "Update" color in the Style Editor

- **Entering the ACP now shows one informational toast when plugin updates are waiting**
  (fed by the daily marketplace update check). Deliberately non-nagging: it fires once per
  update *set* — dismiss or ignore it and it stays silent until a *new* update appears.
  A **View** action jumps to ACP → Marketplace, where the detail banner lives. Updates the
  vendor flagged as critical upgrade the toast to warning styling; everything else uses
  the new neutral **update** category.
- **New toast category `update`** (`toast.update(...)`) with its own semantic token
  `--c-update` (neutral `#414144` in light, a lighter neutral in dark) — and the **Style
  Editor → Feedback section gained the matching "Update" color slot**, so it's themable
  like every other feedback color. The "Preview toasts" button fires an update sample too.
- All five locales updated.

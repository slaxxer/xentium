# Last Codebase Update — 2026-07-24

ACP i18n externalization: the Error Reference page's NEC catalog (the last
significant island of hardcoded English in the ACP) is now fully translatable,
plus a few stray aria-labels. Pure externalization — English text preserved
byte-for-byte.

## ErrorReferencePage.tsx — catalog externalization

- The in-file `CATALOG` (54 NEC codes × msg/desc/cause/fix, hardcoded English)
  was split. The component now holds only `META` (per-code `sev` + `domain` —
  structural: severity drives the badge colour, domain drives filtering). The
  four sentence fields are pulled from the `acp` bundle at render time via
  `t('errorRef.codes.<CODE>.{msg,desc,cause,fix}')`, built into `coreCatalog`
  and merged with server-provided plugin codes exactly as before.
- `sevLabel()` / `domainLabel()` helpers localize the severity badges and domain
  tags (result view, catalog rows, and the domain `<select>`), with
  `defaultValue` fallback so plugin-provided values render raw. Filtering still
  compares the stable English `domain` identifier; catalog search now also
  matches the localized domain label.

## Locale bundles (en/de/es/fr/pt)

- `acp.json` → `errorRef.codes` (54 entries × 4 fields), `errorRef.sev`
  (Critical/Error/Warning/Info), `errorRef.domains` (10 core domains). Added by
  a merge script; diff is a single hunk inside the existing `errorRef` block.
- `common.json` → `actions.decrease` / `actions.increase` (number-stepper
  aria-labels).
- `acp.json` → `topbar.breadcrumb` (ACP breadcrumb nav aria-label).

## Touched TSX

- `pages/ErrorReferencePage.tsx` — CATALOG → META + localized rendering.
- `pages/SettingsPage.tsx` — `NumberStepper` gets `useTranslation("common")`;
  Decrease/Increase aria-labels via `t()`.
- `AcpTopbar.tsx` — breadcrumb aria-label via `t("topbar.breadcrumb")`.

## Verification

- Web typecheck, lint (changed files), and build all green.
- Extracted English catalog is byte-for-byte identical to the previous
  hardcoded strings (checked vs git HEAD — 0 drift fields).
- Key parity: 54 codes present with all 4 fields in every language; sev/domain
  label sets complete and identical across all five bundles.

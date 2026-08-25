# Last codebase update — 2026-08-25

**ACP → Extensions → License, rebuilt from the canvas** in
`nodevo-redesign/License page redesign`. The page was three stacked cards that
each answered a different question; it is now a status hero, one merged
licences-and-entitlements table, and a right rail. Verified in the browser in
both themes against a local marketplace, which is where the one real bug turned
up — everything below passed typecheck, lint and 423 tests before it was found.

## New

| File | Purpose |
|---|---|
| `apps/web/src/features/admin/pages/LicensePage.scss` | The page's styles. Every hex in the canvas mapped to a semantic token — the map is documented in the file header — so the page themes in dark as well as light. |

## Changed

| File | Purpose |
|---|---|
| `apps/web/src/features/admin/pages/LicensePage.tsx` | Rewritten: header action, status hero with five derived states, two-column grid, right rail (connection + entitlement summary). Owns all three queries so hero, table and rail cannot disagree. |
| `apps/web/src/features/admin/components/OwnedLicenses.tsx` | Rewritten as the merged table: product / seats / updates / here / action, with per-row state and action derivation and inline install progress. Now presentational — the query moved up to the page. |
| `apps/web/src/lib/streamProgress.ts` | Two additive optional options, `silent` and `onProgress`, so a caller can render progress itself instead of in the shared dialog. Existing callers and all 10 tests untouched. |
| `apps/web/public/locales/{en,de,es,fr,pt}/acp.json` | 44 new keys each, nested under `license.hero.*`, `license.rail*` and `owned.*`. |

## The bug that only showed up on screen

`rowIsLive` was `!expired && l.activeHere`. But `activeHere` is the
*marketplace's* answer — a seat is bound to this install — and it becomes true
the moment a licence activates, before any files exist locally. Two seeded rows
therefore rendered a green **Active** chip next to an **Install** button, and the
rail counted them as "2 active here".

The canvas had this right (`!!installedVersion && p.activeHere`); the condition
was dropped in the port. A row now requires the activation *and* an installed
version. Same class as every entry in `ui-bugs-pass-tooling`: green tooling,
wrong screen.

## Deliberately not carried over

- The canvas's bottom-right **scenario switcher** — an authoring affordance for
  previewing the nine states, not product UI.
- **"Last checked"**. There is no `lastCheckedAt` on the `License` model, only
  `refreshAfter`, so the rail shows **Next check** from real data instead of
  inventing a relative time. A real column is a small migration if wanted.

## Open

- `MarketplacePage` and `UpdatesPage` still install through the shared progress
  dialog; only this page goes inline. Either propagate it or revert it —
  `acp-page-conventions` says pages should not differ.
- Two `@typescript-eslint/no-explicit-any` warnings in `LicensePage.tsx`, both
  carried over verbatim from the previous file (`parseEntitlements`, the connect
  `onError`). No new lint debt.

# Last codebase update — 2026-08-26 (follow-up)

Follow-up to the Style Editor redesign (PR #92). Everything here was found by using
the page, not by tooling — `backbone:check` was green throughout.

## New

| File | Purpose |
|---|---|
| `apps/web/src/features/admin/pages/fontCss.test.ts` | 8 tests over the shared font builders. Includes one asserting every declaration in the body rule resolves through a `var()` — that indirection is exactly what lets the ACP opt out, and a literal value there would silently re-break it. |

## Changed

| File | Purpose |
|---|---|
| `packages/contracts/src/appearance.ts` | New `FONT_FAMILIES`, `FONT_STACKS`, `fontRootDecls()`, `fontBodyRule()`. One definition of the site font, so the API and the live preview cannot render different fonts. |
| `apps/api/src/modules/appearance/appearance.service.ts` | `buildCSS` builds the font from the shared builders; local `FONT_STACKS` and the hand-rolled declaration lists deleted. Served CSS is byte-identical — verified by diffing the endpoint output. |
| `apps/web/src/features/admin/AcpLayout.scss` | `body.nv-acp` now pins **all four** font properties, not just the family. The served rule targets `body`, and `body.nv-acp` is a body, so pinning only `--ff-sans` / `--font-display` let the site's `--fs-base` and `--fw-body` through. |
| `apps/web/src/features/admin/pages/StyleEditorPage.tsx` | Preview font CSS comes from the shared builders (was: no weight, `html { font-size }`, a different stack, and a dead `body.nv-acp` block injected into the iframe). Autosave writes only the font settings that changed. Tab state lives in the URL. Header split into a state line and an action line. |
| `apps/web/src/features/admin/pages/StyleEditorPage.scss` | `.se-actions` stacks two right-aligned rows; the state line reserves height so the header does not jump. |
| `apps/web/src/features/admin/useAcpNav.ts` | Style History entry removed from Appearance. |
| `apps/web/src/app/App.tsx` | `/admin/style-history` -> `<Navigate to="/admin/style-editor?tab=history" replace />`, following the `guest-home` / `styles` precedent. |
| `apps/web/src/features/admin/pages/StyleHistoryPage.tsx` | **Deleted** — the History tab is the same list. |
| `apps/web/src/features/admin/components/StyleHistoryList.tsx` | Comment updated: it is no longer shared by two surfaces. |
| `apps/web/public/locales/{en,de,es,fr,pt}/acp.json` | `nav.styleHistory`, `styleHistory.sub`, `styleHistory.title` removed — orphaned by the retirement. |

## Verified

`pnpm backbone:check` exit 0 — **478 web tests, 148 API tests, 0 lint errors.**

In the browser, on the running dev instance:

| Check | Before | After |
|---|---|---|
| Set site font to Nunito / 800 — **ACP** | followed the site | Poppins · 16px · **500**, untouched |
| Same change — **preview** | weight had no effect | Nunito · **800** |
| Restore to Poppins / 13px / 700 | — | preview renders 700, ACP stays 500 |
| Recolour one token, count font PUTs | 3 | **0** |
| Change the font size, count font PUTs | 3 | **1** |
| `/admin/style-history` | its own page | redirects to the History tab, tab active |
| Appearance nav | 5 entries | Style Editor · Layout Editor · Themes · Navigation |
| Header | one row of chips | state line (Draft · Review · saved) above the control line |

## Notes

- The ACP opts out by re-pinning custom properties rather than by narrowing the
  server's selector. The admin panel is the only surface that opts out and it is the
  one that knows it; narrowing the rule server-side would put that knowledge in the
  wrong place and complicate a selector every page depends on.
- The font write-amplification is the same defect as the `SettingsPage` one shipped
  in PR #92 ("a save wrote every setting on the page"). Tokens are still written
  whole, because that is one setting holding the entire sparse draft — the three font
  settings are independent rows, which is the difference.

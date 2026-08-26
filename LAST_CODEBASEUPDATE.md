# Last codebase update — 2026-08-26

**The Style Editor, redesigned** (canvas from `nodevo-redesign/Style Editor redesign
plan`), plus the previous session's **ACP settings autosave** fix, which is still
unpushed and ships with it.

## New

| File | Purpose |
|---|---|
| `apps/web/src/features/admin/pages/StyleEditorPage.scss` | The whole page, in semantic tokens. The canvas is authored in light-mode hex; the header comment carries the colour map, which is what makes the page work in dark mode at all — the ACP ships both themes and the design drew one. |
| `apps/web/src/features/admin/pages/styleTokens.ts` | Shared vocabulary: palette rows, the twelve sections, the board clusters, scope options, and `tokenLabel()`. Split out so the style-history list names a token with the same words the editor does. |
| `apps/web/src/features/admin/components/StyleHistoryList.tsx` | The history list, now shared by the Style Editor's History tab and ACP → Appearance → Style history. Derives each row's summary by diffing a snapshot against the one before it — the stored `label` is only a timestamp. |
| `apps/web/src/features/admin/pages/shadowValue.ts` | Reading and writing a `box-shadow` token: direction, distance, blur, spread, colour + alpha, inset. Pure and separate from the control, because the correctness condition is a round trip — and a value that does NOT survive it must be left alone rather than rewritten. |
| `apps/web/src/features/admin/pages/shadowValue.test.ts` | 22 tests: colour forms, direction inference, the refusal cases (stacked shadows, asymmetric offsets, `hsl()`), and a round-trip suite so opening a row and closing it cannot change the stored value. |
| `apps/web/src/features/admin/pages/styleTokens.test.ts` | 17 guards over the parts that fail silently: every registry token has a label key, every locale has the same keys, every board tile points at a section that owns its token, every `inheritsFrom` chain terminates, and the palette's names beat the variant panel's. |

## Changed

| File | Purpose |
|---|---|
| `apps/web/src/features/admin/pages/StyleEditorPage.tsx` | Rewritten. Palette board + typography, preview beside a 404px inspector, four tabs (Tokens / Branding / Custom CSS / History) replacing the fourteen-item rail. New: the publish diff, per-mode change counts, `Jump to…`, "Already set in", the inherit chain per row, hotspot outlining, "Overrides the editor", drag-and-drop branding. `RADIUS_FALLBACK` generalised to `BASE_FALLBACK` so every inheritance chain ends somewhere. |
| `apps/web/src/features/admin/pages/StyleHistoryPage.tsx` | 102 lines → 23. Renders the shared list. |
| `packages/contracts/src/appearance.ts` | `--c-info` and `--c-update` added to `HEARTH_DEFAULT_TOKENS` in both modes. Both are editable Feedback rows; without a default the row rendered empty. |
| `apps/web/public/locales/{en,de,es,fr,pt}/acp.json` | 57 new `styleEditor` keys (13 of them the shadow editor's), 8 new `styleHistory` keys, and a `styleEditor.tok.*` map naming all 40 region/component tokens. 13 retired keys removed. |

## Fixed (found only by opening the page)

| Symptom | Cause |
|---|---|
| "Info" swatch blank, no value | `--c-info` reachable via the editor but absent from `HEARTH_DEFAULT_TOKENS`. |
| "Button text" showed the literal `#rrggbb` | `--btn-fg ← --c-on-accent`, and `--c-on-accent` resolved nowhere — the input rendered its placeholder. |
| Card shadow: three unlit chips | The preset only lit when overridden, so the inherited Soft preset showed as nothing selected. |
| "Primary text" renamed itself to "Text" | Regression I introduced mid-session: `--c-fg`/`--c-fg-muted`/`--c-accent` are in both `VARIANT_TOKEN_ROWS` and the palette rows, and `Object.fromEntries` keeps the last entry. Now tested. |
| Region tokens read as "Inherited" despite being set | Also mine: the canvas's comment says a region group reads its own scope bucket, but every install stores them under `global`. Reverted, with the reason recorded in the code. |
| Dragging any radius slider changed nothing in the preview | The selection ring carried `border-radius:4px`, setting the radius of the element it highlighted. Editing a radius is exactly when its group is selected, so all four controls were dead. Overlay rules extracted to `previewOverlayRules()` and guarded: the ring may decorate, never style. |

## Verified

`pnpm backbone:check` exit 0 — **470 web tests, 148 API tests, 0 lint errors.**

In the browser, on the running dev instance:

| Check | Result |
|---|---|
| Click "Primary" in the preview | Selects Button, scope Content; all three buttons outline |
| Edit `--btn-bg` to `#ff8800` | Preview button turns orange, navbar stays blue (scope respected); row → OVERRIDDEN + spine + "Revert to inherited"; "Already set in · Content · 1" appears; header → "2 unpublished changes" |
| Review | Diff lists both overrides with scope, theme and swatch |
| Revert to inherited | Row → Inherited, footer → "0 of 4 tokens set here", header → "1 unpublished change" |
| Branding / Custom CSS / History tabs | All render; "Overrides the editor" correctly names `--c-accent2` and `--card-radius` |
| Light and dark ACP themes | Both correct |
| Radius sliders, after the overlay fix | Button / Card / Field / Menu each measured at 0px and 26px in the iframe, with that group selected — all four track exactly |
| Header actions | `Reset all` and `Publish now` sized to the 42px row instead of `btn-sm` |
| Shadow editor | Custom seeded losslessly from dark Soft (`0 8px 30px rgba(0,0,0,.34)`); direction, spread and inset each measured landing in the iframe (`inset 8px -8px 30px -8px rgba(0,0,0,.34)`); None clears the panel and computes `none` |

## Notes

- The mode switch now shows only on the Tokens tab. Branding has no per-theme
  values and the Custom CSS console follows the ACP's own theme (`viewedTheme`),
  so on either tab it was a control that did nothing.
- The design's History tab and the existing Style-history nav entry both survive,
  rendering one shared component rather than two drifting copies.

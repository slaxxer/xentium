# Last codebase update — 2026-09-11 (icons)

FontAwesome Pro **per instance**, one site-wide style, and **per-occurrence icon
overrides** in the layout editor. Verified against a real Pro+ kit in a running
browser, not only under test.

`pnpm backbone:check` green — typecheck 30/30, lint 0 errors, API **388** tests,
web **735**, build clean. **No migrations** — the kit and style are settings rows,
and an override lives inside the layout document.

---

## Why a kit, and not bundled Pro

A Pro licence covers the sites its owner operates; Nodevo is installed by strangers on
their own servers. `apps/web` builds to a `dist` each instance deploys, so bundling Pro
would copy licensed artwork into every install — the key stays secret while the thing it
protects is distributed. A kit is fetched at RUNTIME with the admin's own id.

**Full rationale, security rules and the resolution order: `docs/icon-kits.md`.**

## The pieces

| Area | Note |
| --- | --- |
| `modules/appearance/iconKit.ts` | ⚠ SECURITY CODE — this value becomes a `<script src>` |
| `contracts/src/icons.ts` | the style table and the icon-token format, shared by API + web |
| `components/Icon.tsx` | the drop-in wrapper; 66 files import it instead of the library |
| `components/TokenIcon.tsx` | an icon stored as DATA, with the fallback chain |
| `components/IconPicker.tsx` | two tiers: bundled grid, kit-only by name |
| `layout/iconSlots.tsx` | per-occurrence identity |
| `lib/iconScope.tsx` | the ACP keeps the free set |

⚠ **The kit URL is an allowlist, not a string.** Protocol is checked BEFORE host —
`javascript:` and `data:` parse fine and have no hostname. Validated on READ as well as
write; a settings row can arrive from a restored backup.

⚠ **No Pro artwork is bundled.** Only the icon's NAME is read out of the free definition
and handed to the kit as a class.

⚠ **Plugins came free** — they externalise `@fortawesome/react-fontawesome`, so swapping
`FontAwesomeIcon` in `host-globals` covers every plugin with no rebuild.

⚠ **An ESLint guard** (`no-restricted-imports`) stops a new file bypassing the wrapper —
that failure is invisible in review and in tests. It immediately caught a `.ts` file the
`.tsx` sweep had missed.

## Per-occurrence overrides

`BlockNode.iconOverrides`, keyed `"<icon-name>#<n>"` — the nth icon of that name in that
block. Travels with the block; publishes with the draft.

⚠ **Slots are claimed once per component instance, in a ref.** Counting during render was
wrong under StrictMode's double invoke: the first icon was `#1` in development and `#0` in
production, so the key the editor stored was not the key the live site computed.
`iconSlots.test.tsx` renders under `StrictMode` to hold that shut.

⚠ The key stays anchored to the name the CODE asked for, never the replacement — otherwise
an override loses its own anchor and can never be cleared.

⚠ The key is POSITIONAL. Rewriting a block to draw a different number of icons of the same
name can move an existing override onto a neighbour. That is the trade per-occurrence makes.

## Two bugs only looking caught

1. **The preview handshake race** (pre-existing). The editor pushes on the iframe's `load`
   event, which fires before the app inside has subscribed. Icon mode was pushed once and
   silently lost — the toggle read "on" while the preview had no idea. The preview now
   posts `ready` and the editor answers with everything.
2. **A style with no name** stored `"sharp-solid:"` — saved fine, parsed to nothing, drew
   nothing, and looked exactly like a broken control.

## Known limits

- **Pro+ families have partial coverage.** A name they lack renders a missing-glyph BOX,
  not nothing, and a web-font kit gives no signal to hook. The picker's preview is the
  mitigation. Prefer a full-coverage family site-wide; pin Pro+ per icon.
- **Icons outside any block cannot be overridden** — `button.mc-trigger` (the moderation
  canvas launcher) is core chrome in `AppLayout`, not a layout block, so there is nowhere
  to store an override. Plugin slot contributions ARE covered, via `slotBlocks`.

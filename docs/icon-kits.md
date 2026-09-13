# Icons, and FontAwesome Pro

Xentium bundles the **FontAwesome Free** solid set and always will. Core's own chrome
draws with no network call and no third-party script: if a kit fails to load, is
blocked, or was never configured, the application looks and behaves exactly as it
does today.

A **kit** is additive. It is how an admin who has their own FontAwesome Pro
subscription gets Pro icons on their own instance.

## Why not just bundle Pro

A FontAwesome Pro licence covers the sites and apps **its owner operates**. Xentium is
installed by strangers on their own servers, so every install is a different operator.

`apps/web` builds to a `dist` that each instance deploys. Bundling Pro icons at build
time would put the Pro SVG path data — the licensed artwork itself — into the
JavaScript of every install. No amount of key-hiding changes that; the key stays
secret while the thing it protects is copied to everyone. Proxying the assets through
a central server is the same redistribution, plus somebody else's bandwidth bill.

The Pro **npm packages** are unusable here for a second reason: they need an auth
token at *build* time, and admins install a prebuilt artifact.

A kit is the mechanism that works, because it is fetched **at runtime** with the
admin's own kit id, and FontAwesome domain-locks it to their site.

> If Xentium ever wants to ship Pro to everybody, that is a redistribution/OEM
> conversation with FontAwesome's sales team, not an engineering problem. Until then,
> per-instance kits are the only correct model.

## Configuring one

**ACP → Appearance → Style Editor → Branding → FontAwesome Pro kit.**

Paste either the kit id (`a1b2c3d4e5`) or the full
`https://kit.fontawesome.com/a1b2c3d4e5.js` URL. Clearing the field removes it.
Pro icons appear after a reload.

Setting key: `appearance.icons.kit`. It stores the normalised **URL**, never the raw
input.

## The security boundary

⚠ **This is the one setting whose value is executed as JavaScript by every visitor.**
Treat `apps/api/src/modules/appearance/iconKit.ts` as security code.

- The host is an **allowlist** (`kit.fontawesome.com`), so this is a FontAwesome
  integration rather than a general script loader.
- The protocol is checked **before** the host: `javascript:` and `data:` URLs parse
  fine and have no hostname, so a host check alone would never be reached.
- Credentials and explicit ports are refused outright.
- The URL is **rebuilt, not echoed** — any query string or fragment is dropped.
- It has its **own endpoint** (`PUT /appearance/branding/icon-kit`), deliberately not
  the generic `PUT /admin/settings/:key`, which takes any key and any string.
- It is validated **on read as well as on write**. A settings row can arrive from a
  restored backup or a hand-edited database; the write path is not the only way one
  appears.

`iconKit.test.ts` is mostly refusals. That is the point — add a case there before
relaxing anything above.

## Drawing an icon

**Import `FontAwesomeIcon` from `components/Icon`, never from
`@fortawesome/react-fontawesome`.** It is a drop-in: same name, same props, same
`icon={faStar}` call, and it is what applies the site's icon style.

```tsx
import { FontAwesomeIcon } from "../components/Icon";
import { faStar } from "@fortawesome/free-solid-svg-icons";

<FontAwesomeIcon icon={faStar} />
```

⚠ **Keep importing the FREE definitions.** Those imports are what still draws when
there is no kit — the default install, every install that never buys Pro, and any
install whose kit is slow, blocked or broken. Only the icon's **name** is read out of
the definition and handed to the kit as a class; no Pro artwork is ever bundled.

The wrapper falls back to the bundled icon whenever it cannot confidently act:

- no kit configured, or the kit has not finished loading;
- the style is `solid` (the bundled free set);
- the `icon` prop is an array, a string, or anything without a usable `iconName`.

**Plugins need no change.** They externalise `@fortawesome/react-fontawesome` to
`__NODEVO_HOST__.FaReact`, and `host-globals.ts` swaps `FontAwesomeIcon` in that
namespace for this wrapper. One line, and every plugin follows the site style.

`AppIcon` is the other entry point, for when the icon name is **data** — an admin's
choice, such as a badge glyph:

```tsx
<AppIcon name="faStar" />               // bundled free icon
<AppIcon name="fa-duotone fa-dragon" /> // a Pro icon core does not ship
```

⚠ Both components write their `<i>` as raw HTML so **React never owns that node**. A
kit in SVG mode replaces every `fa-` element with an `<svg>` of its own; had React
rendered the `<i>`, unmounting would throw `NotFoundError` on a child FontAwesome had
already swapped out. This works in both SVG and web-font kit modes.

⚠ Class strings are built from a validated icon name and a fixed style list, never
from free text. `AppIcon` additionally closes the charset (`[a-z0-9- ]`) because its
names are admin-supplied.

## Styles

The table lives in `packages/contracts/src/icons.ts` — one list, used by the API to
validate the setting and by the browser to build classes. Tested from
`apps/web/src/lib/iconStyles.test.ts` (contracts has no test runner of its own).

A style is a **family** plus a **weight**. Classic has no family prefix; everything
else names one:

| Family | Weights | Coverage |
| --- | --- | --- |
| Classic | Solid, Regular, Light, Thin | full |
| Duotone | Solid, Regular, Light, Thin | full |
| Sharp | Solid, Regular, Light, Thin | full |
| Sharp Duotone | Solid, Regular, Light, Thin | full |
| Pro+ | one weight each (Chisel, Etch, Graphite, Jelly, Mosaic, Notdog, Pixel, Slab, Thumbprint, Utility, Vellum, Whiteboard and their duo/fill variants) | **partial** |

`solid` is the bundled free set, the default, and the only value that works with no
kit. It resolves to **no classes at all** rather than `fa-solid`.

⚠ **Brands is deliberately absent.** It appears in every kit's style list, so it is an
easy thing to add by mistake — but it is a separate icon SET, not a weight. A
site-wide `fa-brands fa-star` does not exist, and every icon in the product would
vanish at once. `icons.test.ts` pins its absence.

⚠ **Pro+ families have partial coverage.** They are stylised sets, not a weight of the
whole library. A name they have no glyph for renders as a **missing-glyph box**, not
as nothing — visible to visitors, with no error anywhere. Observed live: with the
site style set to Utility, most of the UI drew correctly but the logo mark, a chart
icon and a caret did not. `IconStyleDef.full` records this and the ACP warns.

⚠ Prefer a full-coverage family site-wide, and use Pro+ as a per-icon **pin**, where
the picker's preview shows whether it actually draws.

⚠ Both sides normalise an unknown style to `solid`. A stale row from an older version
or a hand-edited database would otherwise emit a class nothing defines and leave the
site with no visible icons. Renaming an existing id is therefore a **silent revert to
Solid** for anyone who had it set — migrate the stored value if you ever do it.

Setting key: `appearance.icons.style`. The ACP select is disabled until a kit is saved.

## Icons that are DATA

A badge's glyph and a block's icon prop are chosen by an admin, so they are stored,
not written in code. The stored value is an **icon token**:

| Stored | Means |
| --- | --- |
| `star` | follow the site's icon style |
| `jelly-regular:star` | pinned to Jelly, whatever the site is set to |
| `faStar` | legacy, read as `star` |

⚠ **Unpinned is the default and should stay the common case.** It is what lets one
select restyle the whole product; every pin is an exception carved out of that. The
picker never writes a pin unless the admin chooses a style.

Render one with `TokenIcon`, which resolves in this order:

1. the token's pinned style, once the kit has loaded;
2. the site's style, once the kit has loaded;
3. the **bundled** free icon of that name;
4. nothing.

⚠ Step 3 is the promise: a site that loses its kit still looks finished. It only
works for names core actually ships — see `lib/iconCatalogue.ts`, which indexes the
definitions the bundle *already* carries (the badge glyphs and the editor's block
glyphs, ~80) rather than importing the free pack for a picker.

### Adding an icon prop to a block

Declare the hint; nothing needs registering:

```ts
icon: z.string().optional().meta({ title: 'Icon', format: 'icon' }),
```

`SchemaFields` renders the picker for `format: "icon"`, so any block — core or
plugin — gets the control for free. `heading` is the reference implementation.

### The picker's two tiers

The **grid** is what core ships: those draw on every install, forever. The **name
field** reaches anything else the kit carries.

⚠ The grid deliberately renders through the RAW FontAwesome component, NOT the site
style — it is the one place in the app exempt from the lint guard. Drawing ~80
bundled names through a partial Pro+ family fills the grid with missing-glyph boxes
and makes choosing a *shape* impossible. The preview above it is where real styling
is shown, and it is the only ground truth for whether a kit can draw something.

## Changing ONE icon

The admin panel is **excluded from all of this**: it draws with the bundled free set
whatever the site is set to, the same separation that pins its font and its token
layer. `lib/iconScope` carries that; a preview inside the ACP opts back in with
`<IconScope value="site">`, or it would lie about what visitors see.

On the site, any icon can be replaced individually. In the layout editor, turn on
**Icons** in the preview toolbar: every icon outlines, clicking one selects its block
and opens a picker in the rail, and the choice autosaves into the layout draft. It
reaches visitors when the draft is published.

### How one icon is addressed

`BlockNode.iconOverrides`, keyed `"<icon-name>#<n>"` — the nth icon of that name in
that block. The override lives on the block, so it travels when the block is moved or
duplicated and publishes with the rest of the document.

⚠ Numbering is **per name**. Adding an unrelated icon to a block cannot renumber the
`chevron-down`s below it.

⚠ A slot is claimed **once per component instance**, in a ref — never counted freshly
during render. The first implementation did count during render, and React's
double-invoked render made the first icon `#0` in production and `#1` in development:
the key the editor stored was not the key the live site computed. `iconSlots.test.tsx`
renders under `StrictMode` specifically to hold that shut.

⚠ The key stays anchored to the name the **code** asked for, never to the replacement.
Renaming the slot on override would lose its own anchor and it could never be edited
or cleared again.

⚠ The key is **positional**, which is the trade per-occurrence makes. If a block is
later rewritten to draw a different number of icons *of the same name*, an existing
override can land on a neighbour.

### When a replacement cannot be drawn

It falls back to the icon the code asked for. A hole where a control used to be is
worse than a wrong-but-present icon.

⚠ That fallback only covers what is **detectable**: no kit, or a style that resolves
to no classes. A kit that simply lacks the glyph renders a missing-glyph box, and a
web-font kit gives no signal we could hook. The picker's preview is the mitigation —
it draws the real thing, so the box is visible before saving.

## Known behaviour

- **First visit shows free icons briefly.** The app is a static SPA — there is no
  server render to put the script tag in the HTML — so the kit can only be requested
  after boot. The URL is cached in `localStorage`, so subsequent loads inject it
  immediately.
- **Changing a kit or style takes effect on the next load.** A script that has been
  executed cannot be unloaded.
- **Kit mode does not matter.** Web-font kits leave the `<i>` in place; SVG kits
  replace it. Both work, because React never owns that node.

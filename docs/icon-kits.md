# Icons and FontAwesome Pro

We bundle the **FontAwesome Free** solid set, and that won't change. Core draws its own
UI without any network call or third-party script, so if a kit fails to load, gets
blocked or was never set up, everything looks and works exactly as it does without one.

A **kit** only adds to that. It's how an admin with their own FontAwesome Pro
subscription gets Pro icons on their own site.

## Why we don't just bundle Pro

A FontAwesome Pro licence covers the sites and apps **its owner runs**. Xentium gets
installed by lots of different people on their own servers, so every install has a
different owner.

`apps/web` builds into a `dist` that every instance deploys. If we bundled Pro icons at
build time, the Pro SVG path data (the licensed artwork itself) would end up in the
JavaScript of every install. Hiding the key doesn't help: the key stays secret while the
thing it protects gets copied everywhere. Proxying the icons through a central server is
the same redistribution, plus someone else's bandwidth bill.

The Pro **npm packages** don't work here for a second reason: they need an auth token at
*build* time, and admins install something that's already built.

A kit works because it's loaded **at runtime** with the admin's own kit id, and
FontAwesome locks it to their domain.

> If we ever want to ship Pro to everyone, that's a licensing conversation with
> FontAwesome's sales team, not an engineering problem. Until then, a kit per instance
> is the only correct way.

## Setting one up

**ACP → Appearance → Themes → Colours (on any theme) → Branding → FontAwesome Pro kit.**

Paste the kit id (`a1b2c3d4e5`) or the whole `https://kit.fontawesome.com/a1b2c3d4e5.js`
URL. Clear the field to remove it. Pro icons show up after a reload.

It's stored in the setting `appearance.icons.kit`, as a normalized **URL**, never the
raw input.

## This is security code

**It's the one setting whose value every visitor's browser runs as JavaScript**, so treat
`apps/api/src/modules/appearance/iconKit.ts` as security code.

- The host is on an **allowlist** (`kit.fontawesome.com`). This is a FontAwesome
  integration, not a general way to load scripts.
- We check the protocol **before** the host. `javascript:` and `data:` URLs parse fine
  and have no hostname, so a host check alone would never catch them.
- Credentials and explicit ports are refused.
- We **rebuild** the URL instead of echoing what came in, so any query string or fragment
  is dropped.
- It has **its own endpoint** (`PUT /appearance/branding/icon-kit`) on purpose, not the
  generic `PUT /admin/settings/:key`, which accepts any key and any string.
- We validate it **when we read it, too**, not just when it's written. A settings row can
  come from a restored backup or a hand-edited database.

`iconKit.test.ts` is mostly refusals, and that's intended. Add a test case there before
you loosen anything above.

## Drawing an icon

**Import `FontAwesomeIcon` from `components/Icon`, never from
`@fortawesome/react-fontawesome`.** It's a drop-in replacement (same name, same props,
same `icon={faStar}`), and it's what applies the site's icon style.

```tsx
import { FontAwesomeIcon } from "../components/Icon";
import { faStar } from "@fortawesome/free-solid-svg-icons";

<FontAwesomeIcon icon={faStar} />
```

**Keep importing the free definitions.** They're what draws when there's no kit: on a
default install, on every install that never buys Pro, and on any install whose kit is
slow, blocked or broken. We only read the icon's **name** from the definition and pass
it to the kit as a class. No Pro artwork is ever bundled.

The wrapper falls back to the bundled icon whenever it can't be sure:

- no kit is set up, or it hasn't finished loading;
- the style is `solid` (the bundled free set);
- the `icon` prop is an array, a string, or anything else without a usable `iconName`.

**Plugins don't need to change anything.** They externalize
`@fortawesome/react-fontawesome` to `__XENTIUM_HOST__.FaReact`, and `host-globals.ts`
swaps `FontAwesomeIcon` in that namespace for our wrapper. One line, and every plugin
follows the site's style.

`AppIcon` is the other way in, for when the icon name is **data**, i.e. an admin's
choice, like a badge glyph:

```tsx
<AppIcon name="faStar" />               // a bundled free icon
<AppIcon name="fa-duotone fa-dragon" /> // a Pro icon core doesn't ship
```

Both components write their `<i>` as raw HTML, so **React never owns that node**. A kit in
SVG mode replaces every `fa-` element with its own `<svg>`. If React had rendered the
`<i>`, unmounting would throw `NotFoundError` on a child FontAwesome had already swapped
out. This way it works in both SVG and web-font kit modes.

We build class strings from a validated icon name and a fixed list of styles, never from
free text. `AppIcon` also restricts the characters (`[a-z0-9- ]`), because its names come
from admins.

## Styles

The list lives in `packages/contracts/src/icons.ts`. The API uses it to validate the
setting and the browser uses it to build classes. The tests are in
`apps/web/src/lib/iconStyles.test.ts` (contracts has no test runner of its own).

A style is a **family** plus a **weight**. Classic has no family prefix; the others do:

| Family | Weights | Coverage |
| --- | --- | --- |
| Classic | Solid, Regular, Light, Thin | full |
| Duotone | Solid, Regular, Light, Thin | full |
| Sharp | Solid, Regular, Light, Thin | full |
| Sharp Duotone | Solid, Regular, Light, Thin | full |
| Pro+ | one weight each (Chisel, Etch, Graphite, Jelly, Mosaic, Notdog, Pixel, Slab, Thumbprint, Utility, Vellum, Whiteboard and their duo/fill variants) | **partial** |

`solid` is the bundled free set, the default, and the only style that works without a
kit. It turns into **no classes at all**, not `fa-solid`.

**Brands is left out on purpose.** It shows up in every kit's style list, so it's easy to
add by accident, but it's a separate icon *set*, not a weight. There's no site-wide
`fa-brands fa-star`, and every icon in the product would disappear at once.
`icons.test.ts` makes sure it stays out.

**Pro+ families only cover part of the library.** They're stylized sets, not a weight of
the whole library. A name they don't have a glyph for shows as a **missing-glyph box**,
not as nothing, so visitors see it and nothing logs an error. We saw this live: with the
site set to Utility, most of the UI looked right, but the logo mark, a chart icon and a
caret didn't. `IconStyleDef.full` records this, and the ACP warns about it.

So for the whole site, prefer a family with full coverage, and use Pro+ to **pin**
individual icons, where the picker's preview shows whether it actually draws.

Both the API and the browser turn an unknown style into `solid`. Otherwise a stale value
from an older version or a hand-edited database would produce a class nothing defines,
and the site would have no visible icons. That also means renaming an existing style id
**silently reverts** everyone who had it set to Solid, so migrate the stored value if you
ever do that.

It's stored in `appearance.icons.style`. The ACP select is disabled until a kit is saved.

## Icons as data

A badge's glyph and a block's icon prop are chosen by an admin, so they're stored, not
written in code. What we store is an **icon token**:

| Stored | Means |
| --- | --- |
| `star` | follow the site's icon style |
| `jelly-regular:star` | always Jelly, whatever the site is set to |
| `faStar` | the old format, read as `star` |

**Unpinned is the default and should stay the normal case.** It's what lets one setting
restyle the whole product, and every pin is an exception to that. The picker never
stores a pin unless the admin picks a style.

Render a token with `TokenIcon`, which tries these in order:

1. the token's pinned style, once the kit has loaded;
2. the site's style, once the kit has loaded;
3. the **bundled** free icon with that name;
4. nothing.

Step 3 is what we promise: a site that loses its kit still looks finished. It only works
for names core actually ships. `lib/iconCatalogue.ts` indexes the definitions the bundle
*already* includes (the badge glyphs and the editor's block glyphs, about 80) instead of
importing the whole free pack just for a picker.

### Adding an icon prop to a block

Declare the hint; there's nothing to register:

```ts
icon: z.string().optional().meta({ title: 'Icon', format: 'icon' }),
```

The settings form shows the picker for `format: "icon"`, so any block, core or plugin,
gets the control for free. `heading` is the reference.

### The picker's two parts

The **grid** shows what core ships; those icons draw on every install. The **name
field** reaches anything else the kit has.

The grid renders with the *raw* FontAwesome component, not the site's style. It's the
one place in the app that's exempt from our lint rule. Drawing ~80 bundled names in a
partial Pro+ family would fill the grid with missing-glyph boxes and make it impossible
to pick a *shape*. The preview above the grid shows the real styling, and it's the only
reliable way to tell whether a kit can draw something.

## Changing a single icon

The admin panel **stays out of all this**. It draws with the bundled free set whatever
the site is set to, just like it keeps its own font and its own colours.
`lib/iconScope` handles that, and a preview inside the ACP opts back in with
`<IconScope value="site">`, or it would show something visitors don't see.

On the site, any icon can be replaced on its own. In Theme Studio's Layout mode, switch on
**Icons** in the preview toolbar: every icon gets an outline, clicking one selects its
block and opens a picker in the side panel, and your choice autosaves into the layout
draft. Visitors see it once the draft is published.

### How we address one icon

With `BlockNode.iconOverrides`, keyed `"<icon-name>#<n>"`: the nth icon with that name in
that block. The override lives on the block, so it moves with the block when it's moved
or duplicated, and it's published with the rest of the document.

Numbering is **per name**. Adding an unrelated icon to a block can't renumber the
`chevron-down`s below it.

Each component instance claims its slot **once**, in a ref, and never counts it again
during render. Our first version counted during render, and because React renders twice
in development, the first icon was `#0` in production and `#1` in development: the key the
editor stored wasn't the key the live site computed. `iconSlots.test.tsx` renders under
`StrictMode` specifically to keep that fixed.

The key stays tied to the name the **code** asked for, never to the replacement. If the
slot were renamed on override, it would lose its own anchor and could never be edited or
cleared again.

The key is **positional**; that's the price of addressing individual occurrences. If a
block is later changed to draw a different number of icons *with the same name*, an
existing override can land on the icon next to it.

### When a replacement can't be drawn

We fall back to the icon the code asked for. A wrong icon is better than a hole where a
control used to be.

That fallback only covers what we can **detect**: no kit, or a style that turns into no
classes. A kit that just doesn't have the glyph draws a missing-glyph box, and a
web-font kit doesn't give us any signal to hook into. The picker's preview is the
safeguard: it draws the real thing, so you see the box before you save.

## Things you'll notice

- **The first visit briefly shows free icons.** The app is a static SPA with no server
  rendering to put the script tag in the HTML, so the kit can only be requested after the
  app starts. We cache the URL in `localStorage`, so later visits load it immediately.
- **A new kit or style takes effect on the next page load.** A script that has already
  run can't be unloaded.
- **Kit mode doesn't matter.** Web-font kits leave the `<i>` in place and SVG kits replace
  it. Both work, because React never owns that node.

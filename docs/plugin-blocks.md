# Plugin-authored layout blocks

> Companion to ADR-0005 (block layout composition). Read that first for the model;
> this document is the authoring contract.

Xentium has exactly two kinds of extension, and no third:

| | Contains | Trust | Distribution |
|---|---|---|---|
| **Theme** | Layout documents + tokens + assets. **Data only.** | None needed — validated against a schema | `.nvtheme` ([format](./theme-packages.md)) |
| **Plugin** | Code: blocks, routes, server logic, migrations | Trusted, reviewed | `.nvplugin` |

A theme can never execute code. So "I need a component the catalogue doesn't have"
is answered by **ship a plugin that registers a block** — which also gets you
permissions, migrations, server routes and licensing, none of which a theme could
have had.

## Registering a block

Blocks live in the **web** half of a plugin. Register them at module load, from
the plugin's web entry — the host awaits every plugin bundle before it mounts
React, so registration always happens before the first render.

```ts
// vite.config.ts — externalize the registry, do not bundle it
const externals = {
  // …existing entries…
  "@web/layout/blockRegistry": `${H}.webBlockRegistry`,
};
```

```tsx
// web/blocks/MyBlock.tsx
import { z } from "zod";
import { registerBlock, type BlockProps } from "@web/layout/blockRegistry";

const propsSchema = z.object({
  limit: z.number().int().min(1).max(20).default(5)
    .meta({ title: "Items to show", description: "How many rows to list." }),
});

function MyBlock({ props, context }: BlockProps<z.infer<typeof propsSchema>, unknown>) {
  return <div>…</div>;
}

registerBlock({
  type:       "myplugin.recentItems",  // NAMESPACED — see below
  pluginId:   "nodevo-myplugin",       // enables removal when disabled
  schema:     propsSchema,
  component:  MyBlock,
  editorMeta: { label: "Recent items", category: "plugin" },
});
```

```tsx
// web/index.tsx — import for side effect
import "./blocks/MyBlock";
```

## The rules

**Namespace the type.** Core blocks are bare (`heading`, `articleIndex`); plugin
blocks are `<namespace>.<name>`. A collision would make two blocks fight over one
key in every stored document on every site.

**Set `pluginId`.** It is what lets `deregisterBlocksFor()` remove your blocks when
the plugin is disabled. It is explicit rather than derived from the type prefix
because a plugin id (`nodevo-forum`) and its namespace (`forum.`) are not the same
string.

**The schema is the editor.** The props form is generated from your Zod schema via
`z.toJSONSchema` — there is no editor UI to write. Use `.meta({ title, description })`
to label fields. Supported: string, number/integer (with `min`/`max`), boolean,
enums, and unions of literals. Anything else is skipped rather than guessed at.

**Keep props coarse.** Every prop is permanent: stored documents — including ones
inside themes you did not author — must migrate forever when it changes. Fine
visual control belongs to Style Editor tokens (ADR-0003), not to block props.

**Omit `editorMeta` to hide a block** from the picker while keeping it renderable.
Useful for blocks only your own default documents place.

**Restrict with `allowedTemplates`** when a block needs a template's context —
e.g. `["article.detail"]` for something that needs an article. Omit it and the
block is offered everywhere.

## Containers: blocks that hold other blocks

Set `container: true` and render the `children` you are given. The host walks the
tree and hands you already-rendered children — you decide where they go, never
what they are.

```tsx
registerBlock({
  type:      "myplugin.tabs",
  pluginId:  "nodevo-myplugin",
  schema:    tabsSchema,
  container: true,
  childTypes: ["myplugin.tab"],           // optional: what this will accept
  editorMeta: { label: "Tabs", category: "plugin" },
  component: ({ children }) => <div className="mp-tabs">{children}</div>,
});

registerBlock({
  type:      "myplugin.tab",
  pluginId:  "nodevo-myplugin",
  schema:    tabSchema,
  container: true,
  editorMeta: {
    label: "Tab", category: "plugin",
    onlyInside: ["myplugin.tabs"],        // never offered at region level
  },
  component: ({ children }) => <div className="mp-tab">{children}</div>,
});
```

**`childTypes` and `onlyInside` are the two halves of one relationship** — what a
container accepts, and where a child is allowed to live. The editor consults both
before it offers a drop, so a target that would be refused never gets an
indicator. Core's `columns`/`column` pair is the same shape.

**Derive structure from the tree, not from a prop.** `columns` has no `count`: its
track count is how many `column` children it has. A number that duplicates the
tree is a number that will disagree with it.

**Depth is capped** at `MAX_BLOCK_DEPTH` (5, counting a region's own blocks as 1),
enforced in the editor and again on save. A container is not a licence to nest
without limit, and a stored document is not always one the editor produced.

**Children survive their container being unknown.** If your plugin is disabled, the
container is skipped at render but the whole subtree stays in the document, so
re-enabling restores it exactly as the admin left it.

## Your existing slot contributions are already blocks

You do not have to adopt anything for an admin to be able to move your UI. Every
`slotRegistry` contribution is **automatically mirrored as a layout block**
(`layout/slotBlocks.tsx`), so a header widget, a layout widget or a profile tab you
registered years ago shows up in the layout editor's picker and can be placed
anywhere its template allows:

| You registered | Derived block | Placeable on |
|---|---|---|
| `registerHeaderWidget` | `slot.headerWidget.<id>` | `chrome.header` |
| `registerLayoutWidget` | `slot.layoutWidget.<id>` | any page template |
| `registerProfileTab` | `slot.profileTab.<id>` | `profile` |

The derived block carries your `pluginId`, so disabling your plugin removes it — and
the admin's document keeps the node, because an unknown type is skipped and kept.
Re-enable and it comes back where they put it.

**Layout widgets keep their outlet check.** Your component still receives an `outlet`
and still decides whether to render — breaking that would blank out every existing
widget. What changes is that the ADMIN picks which outlet identity the block renders
as, so placement is theirs while your gate still runs. A widget that ignores `outlet`
works everywhere.

**Registering a block directly is still better for new work**, because you get typed
props and a generated settings form. The bridge is for what already exists.

## Audiences are applied for you

An admin can limit any block to guests, members, or specific groups. **Do not
implement this yourself** — the host evaluates it before your component is called,
so a block that the audience excludes never renders.

Two consequences worth internalising:

**It only ever narrows.** Your own gating still runs when the audience admits the
viewer. If your block returns `null` for guests, an admin cannot make it appear for
them by choosing "Everyone". A layout is data, and data must never widen access.

**It is presentation, not access control.** Hiding your block does not stop the
endpoint behind it from answering. If your block exposes something sensitive, gate
the **endpoint** — `requirePermission` on your route, not an admin's layout choice.

The editor shows a restricted block regardless of whether the admin is in the
audience, marked `data-nv-restricted` in the preview and flagged in the tree, so
they never lose the ability to select it and undo.

## Style variants apply to your block for free

An admin can put a **style variant** (`surface` / `muted` / `accent` / `plain`) on any
container block, yours included. It is applied as a class on a `display: contents`
wrapper, so it costs you nothing and cannot disturb your block's layout — but it only
*shows* if your CSS reads the tokens it sets.

So paint from tokens, not literals — which the codebase requires anyway:

```scss
.myplugin-panel {
  background: var(--card-bg);            /* follows the variant */
  border: 1px solid var(--c-border);     /* follows the variant */
  border-radius: var(--card-radius);
  color: var(--c-fg);
}
```

If your block is a generic *surface* rather than a card — the plugin equivalent of core's
`section` — read the surface set instead, and supply the fallback so an unstyled instance
paints nothing:

```scss
.myplugin-surface {
  background: var(--surface-bg, transparent);
  border: var(--surface-border-width, 0) solid var(--surface-border, transparent);
  border-radius: var(--surface-radius, 0);
}
```

Do **not** add colour props to your block's schema. The Layout Editor's Style panel edits
the variant's tokens, so a colour set there stays consistent across every block using that
variant and travels inside a `.nvtheme`; a prop would be a per-block literal that breaks
dark mode and cannot be themed.

## Icons in your block

Two things happen to your block's icons for free, and one thing you have to not break.

**They follow the site's icon style.** Import `FontAwesomeIcon` from the module your
vite config already externalises (`@fortawesome/react-fontawesome` →
`__NODEVO_HOST__.FaReact`). Core swaps that export for its own wrapper, so a site using
a FontAwesome Pro kit draws your icons in its chosen style with no change on your side.

⚠ Bundling your own copy of that package silently opts out — your icons stay solid while
the rest of the page changes. Keep it external.

**An admin can replace any one of them.** In the layout editor, Icons mode makes every
icon on the page clickable, and the replacement is stored on the block node
(`iconOverrides`, keyed `"<icon-name>#<n>"` — the nth icon of that name your block drew,
in render order). You do nothing; it applies inside the wrapper.

⚠ The key is POSITIONAL. If you later change how many icons of the **same name** your
block renders, an existing override can land on a neighbour. Adding an icon of a
*different* name is always safe — numbering is per name.

### An icon as a PROP

When the icon is the admin's choice rather than your design, declare it and the editor
renders a picker:

```ts
const schema = z.object({
  icon: z.string().optional().meta({ title: "Icon", format: "icon" }),
});
```

`format: "icon"` is a hint `SchemaFields` honours — nothing to register. Render it with
`TokenIcon`, which resolves the pinned style, then the site's, then the bundled free
icon, then nothing:

```tsx
// Externalise this like the rest — it is `__NODEVO_HOST__.webTokenIcon`.
import { TokenIcon } from "@web/components/TokenIcon";

component: ({ props }) => props.icon ? <TokenIcon token={props.icon} /> : null,
```

⚠ Keep it **optional and undefaulted**. Absent means no icon; a default would put one on
every instance ever created, and the document compares by value.

Full detail: `docs/icon-kits.md`.

## So does the admin's CSS handle

Beside the variant an admin may give any block a **`className`** — their own handle for
custom CSS. Like the variant it rides the `display: contents` wrapper, so your block
gets it without registering anything, without a prop, and without the class ever landing
on an element you position.

Your block also gets **`nv-b--<your-type>`** on that wrapper, automatically. A dotted type
is flattened for the selector, so `myplugin.stats` is `.nv-b--myplugin-stats`. That is the
hook a downloaded theme uses to skin your block, since a theme cannot add a handle to
layouts it does not control.

Three consequences for you:

- **Do not add a `className` prop of your own.** It already exists one level up, on the
  node, and a second one would be a permanent per-block surface duplicating it.
- **Give your block's real elements stable, prefixed classes**, because that is what a
  theme ends up selecting — `.nv-b--myplugin-stats .myplugin-stats__count`. Treat those
  class names as part of your block's public contract: renaming one breaks a theme exactly
  the way renaming a prop would. So is your block's TYPE, now that the class is derived
  from it.
- **Never use `>`, `+` or `~` across a block boundary in your stylesheet.** The wrapper
  sits between a container block and its children in the DOM, and selectors match the DOM
  even though the wrapper generates no box. Use descendant selectors. Core shipped this
  bug once and it broke the mobile collapse for every styled column.

## Data: core blocks vs plugin blocks

Core blocks **never fetch**. They receive data as props from a host container that
already ran the query and the permission checks, because a theme document must not
be able to widen what a page shows.

Plugin blocks **may query their own endpoints**. A plugin is trusted code that
ships its own permission-checked routes, and core cannot resolve your data for
you. The invariant is unchanged: the layout **document** grants nothing — access is
decided by your API, for the requesting viewer.

```tsx
// Fine: your endpoint applies your visibility rules server-side.
const { data } = useQuery({ queryKey: ["my-block"], queryFn: () => api.get("/myplugin/items") });
```

Do **not** accept an id or a filter from props and trust it. Props come from a
layout document, which an admin — or an imported theme — authored.

## What happens when your plugin is disabled

Nothing breaks, and nothing is lost:

- The renderer **skips** an unknown block type and renders the rest of the page.
- The block **stays in the document**, so re-enabling the plugin restores it
  exactly where the admin placed it.
- In the ACP the node shows as *"Block `x` is unavailable"* rather than vanishing.

This is why stored layouts survive version and plugin changes. Do not work around
it by writing placeholder blocks into core.

## Opening your own pages to the layout editor

A block is something an admin can place on a page core already owns. A **layout
template** is the other half: one of *your* pages, opened up so an admin can arrange
it the same way.

Core's eight template keys are a fixed enum, and that stays true for **themes** —
a theme is data, and data must never be able to invent a route. A plugin is code
that already owns its routes, so declaring the regions of a page it already renders
adds nothing it could not do. What it adds is an admin's ability to arrange it.

### Declare it once, register it twice

The server's registry decides what may be **saved** (it validates every draft and
every `.nvtheme` import against your declared regions); the browser's decides what
**renders**. Share one declaration so the two cannot disagree:

```ts
// shared/layoutTemplates.ts — imported by BOTH entries
import type { LayoutTemplateDeclaration } from "@nodevo/plugin-sdk";

export const MY_INDEX: LayoutTemplateDeclaration = {
  key:      "myplugin.index",     // namespaced; a bare word is refused
  label:    "My index",           // shown in the editor's picker
  pluginId: "my-plugin",
  regions:  ["header", "main", "aside", "footer"],
  previewRoute: "/mypage",        // same-origin path the ACP previews at
  defaultDocument: {
    templateKey: "myplugin.index",
    regions: { main: [{ id: "my-index", type: "myplugin.indexPage", props: {} }] },
  },
};
```

```ts
// server/index.ts
ctx.registerLayoutTemplate(MY_INDEX);
```

```tsx
// web/index.tsx
import { registerTemplate } from "@web/layout/templateRegistry";
registerTemplate(MY_INDEX);
```

### Render it from your route

Your page component becomes a **host container**: it resolves the document (and any
data its blocks need) and lets the document decide what renders where.

```tsx
import { LayoutRenderer } from "@web/layout/LayoutRenderer";
import { useLayoutDocument } from "@web/layout/useLayout";

export function MyIndexRoute() {
  const layout = useLayoutDocument("myplugin.index");
  return <LayoutRenderer templateKey="myplugin.index" document={layout} />;
}
```

⚠ **Externalize all three `@web/layout/*` imports** in your vite config
(`templateRegistry`, `LayoutRenderer`, `useLayout`) exactly as you already
externalize `blockRegistry`. A bundled copy registers into its own module-level
registry, which the host never reads — the template would silently not exist.

### What is refused, and why

`registerTemplate` **throws** rather than warning, so a bad declaration fails the
enable instead of leaving your plugin half-registered:

- a **core** template key — a plugin must never be able to redefine `home`;
- a key another plugin already registered (re-registering your own is fine, and is
  what happens on every enable);
- a key with no namespace;
- an off-origin `previewRoute` — it loads in an ACP iframe;
- no regions, a duplicated region, or a region name that is not an identifier;
- a `defaultDocument` that would not survive a save: wrong template key, an
  undeclared region, a broken tree, or a missing required block.

### What happens when your plugin is disabled

The same rule as a block, one level up. The template is deregistered, so the editor
stops offering it and the public payload stops carrying it — but **the stored
documents are kept**. Re-enabling restores the admin's arrangement in place.

A `.nvtheme` that ships your template is skipped on a site without your plugin
(there are no declared regions to validate it against) and reported in the import's
`unknownTemplates`, so the admin can enable your plugin and re-import.

### Variants are core-only for now

`VARIANT_TEMPLATES` — per-instance layouts, like one custom page's own arrangement —
declares nothing for plugin templates, so a variant on one is a 422. A variant needs
a source of *instances* for the editor's picker, and there is no way for a plugin to
supply one yet.

## Reference implementation

`plugins/official/nodevo-forum/web/blocks/ForumCategoriesBlock.tsx` registers
`forum.categories`, backed by `/forum/nodes` — an endpoint that applies its own
`visibilityFilter` per viewer.

For templates, the same plugin's `shared/layoutTemplates.ts` +
`web/pages/ForumIndexRoute.tsx` + `web/blocks/ForumIndexBlock.tsx` are the whole
pattern end to end.

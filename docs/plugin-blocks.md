# Plugin-authored layout blocks

This page is the contract for writing layout blocks in a plugin. For the idea behind
layouts, read [The layout system](../README.md#layout-system) first.

Xentium has exactly two kinds of extension:

| | What's in it | Trust | Ships as |
|---|---|---|---|
| **Theme** | Layout documents, tokens and assets. **Data only.** | None needed; we validate it against a schema | `.xttheme` ([format](./theme-packages.md)) |
| **Plugin** | Code: blocks, routes, server logic, migrations | Trusted and reviewed | `.xtplugin` |

A theme can never run code. So when you think "I need a component the catalogue doesn't
have", the answer is **a plugin that registers a block**. That also gets you
permissions, migrations, server routes and licensing, none of which a theme could have.

## Registering a block

Blocks live in the **web** half of your plugin. Register them when your web entry loads.
The host waits for every plugin bundle before it mounts React, so your registration
always happens before the first render.

```ts
// vite.config.ts: externalize the registry, don't bundle it
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
  type:       "myplugin.recentItems",  // NAMESPACED, see below
  pluginId:   "xentium-myplugin",       // lets us remove it when the plugin is disabled
  schema:     propsSchema,
  component:  MyBlock,
  editorMeta: { label: "Recent items", category: "plugin" },
});
```

```tsx
// web/index.tsx: import it for the side effect
import "./blocks/MyBlock";
```

## The rules

**Namespace the type.** Core blocks have bare names (`heading`, `articleIndex`); plugin
blocks are `<namespace>.<name>`. If two blocks shared a name, they'd fight over the same
key in every stored document on every site.

**Set `pluginId`.** That's how `deregisterBlocksFor()` finds your blocks when the plugin
is disabled. We don't derive it from the type prefix, because a plugin id
(`xentium-forum`) and its namespace (`forum.`) aren't the same string.

**Your schema is the editor.** We generate the settings form from your Zod schema with
`z.toJSONSchema`, so there's no editor UI to write. Label fields with
`.meta({ title, description })`. We support strings, numbers/integers (with `min`/`max`),
booleans, enums and unions of literals. Anything else is skipped instead of guessed at.

**Keep props coarse.** Every prop is forever. Stored documents, including ones inside
themes you didn't write, have to keep working whenever a prop changes. Fine visual
control belongs in Style Editor tokens, not in block props.

**Leave out `editorMeta` to hide a block** from the picker while it still renders. That's
handy for blocks that only your own default documents place.

**Limit it with `allowedTemplates`** when a block needs a template's context, e.g.
`["article.detail"]` for something that needs an article. Without it, the block is
offered everywhere.

## Containers: blocks that hold other blocks

Set `container: true` and render the `children` you're given. The host walks the tree
and hands you children that are already rendered. You decide where they go, never what
they are.

```tsx
registerBlock({
  type:      "myplugin.tabs",
  pluginId:  "xentium-myplugin",
  schema:    tabsSchema,
  container: true,
  childTypes: ["myplugin.tab"],           // optional: what this container accepts
  editorMeta: { label: "Tabs", category: "plugin" },
  component: ({ children }) => <div className="mp-tabs">{children}</div>,
});

registerBlock({
  type:      "myplugin.tab",
  pluginId:  "xentium-myplugin",
  schema:    tabSchema,
  container: true,
  editorMeta: {
    label: "Tab", category: "plugin",
    onlyInside: ["myplugin.tabs"],        // never offered directly in a region
  },
  component: ({ children }) => <div className="mp-tab">{children}</div>,
});
```

**`childTypes` and `onlyInside` are two sides of the same relationship:** what a
container accepts, and where a child is allowed to live. The editor checks both before it
offers a drop, so it never shows a drop target that would be refused. Core's
`columns`/`column` pair works the same way.

**Get structure from the tree, not from a prop.** `columns` has no `count`; the number of
tracks is the number of `column` children. A number that repeats what the tree already
says will sooner or later disagree with it.

**Nesting has a limit:** `MAX_BLOCK_DEPTH` is 5 (a region's own blocks count as 1). The
editor enforces it, and so does every save, because a stored document didn't
necessarily come from the editor.

**Children survive when their container is unknown.** If your plugin is disabled, we
skip the container when rendering, but its whole subtree stays in the document. Enable
the plugin again and everything is back the way the admin left it.

## Your existing slot contributions are already blocks

You don't have to change anything for an admin to be able to move your UI. We mirror
every `slotRegistry` contribution **as a layout block automatically**
(`layout/slotBlocks.tsx`), so a header widget, layout widget or profile tab you
registered long ago shows up in the Layout Editor's picker and can be placed anywhere its
template allows:

| You registered | The block you get | Placeable on |
|---|---|---|
| `registerHeaderWidget` | `slot.headerWidget.<id>` | `chrome.header` |
| `registerLayoutWidget` | `slot.layoutWidget.<id>` | any page template |
| `registerProfileTab` | `slot.profileTab.<id>` | `profile` |

The mirrored block carries your `pluginId`, so disabling your plugin removes it, and the
admin's document keeps the node, since an unknown type is skipped and kept. Enable it
again and it comes back where they put it.

**Layout widgets keep their outlet check.** Your component still gets an `outlet` and
still decides whether to render; changing that would blank out every existing widget.
The difference is that the *admin* now picks which outlet the block renders as. They
control placement, your check still runs. A widget that ignores `outlet` works
everywhere.

**For new work, register a block directly.** You get typed props and a generated
settings form. The mirroring is for what already exists.

## Audiences are handled for you

An admin can restrict any block to guests, members or specific groups. **Don't build that
yourself.** The host checks it before your component is called, so a block the audience
excludes never renders.

Two things follow from that:

**It only ever narrows.** Your own checks still run when the audience lets the viewer
in. If your block returns `null` for guests, an admin can't make it show up for them by
choosing "Everyone". A layout is data, and data must never widen access.

**It's presentation, not access control.** Hiding your block doesn't stop the endpoint
behind it from answering. If your block shows something sensitive, protect the
**endpoint** with `requirePermission` on your route, not with an admin's layout choice.

The editor always shows a restricted block, whether or not the admin is in its audience.
It's marked `data-xt-restricted` in the preview and flagged in the tree, so the admin can
always select it and undo.

## Style variants work on your block for free

An admin can put a **style variant** (`surface` / `muted` / `accent` / `plain`) on any
container block, yours too. It's a class on a `display: contents` wrapper, so it costs you
nothing and can't disturb your layout. It only *shows*, though, if your CSS uses the
tokens it sets.

So paint with tokens, not literal values (which we require anyway):

```scss
.myplugin-panel {
  background: var(--card-bg);            /* follows the variant */
  border: 1px solid var(--c-border);     /* follows the variant */
  border-radius: var(--card-radius);
  color: var(--c-fg);
}
```

If your block is a generic *surface* rather than a card (the plugin equivalent of core's
`section`), read the surface tokens instead and give fallbacks, so an unstyled instance
paints nothing:

```scss
.myplugin-surface {
  background: var(--surface-bg, transparent);
  border: var(--surface-border-width, 0) solid var(--surface-border, transparent);
  border-radius: var(--surface-radius, 0);
}
```

Please **don't** add colour props to your block's schema. The Layout Editor's Style panel
edits the variant's tokens, so a colour set there stays consistent across every block
using that variant and travels inside a `.xttheme`. A colour prop would be a hard-coded
value on one block that no theme can restyle.

## Icons in your block

Two things happen to your block's icons without you doing anything, and there's one thing
you must not break.

**They follow the site's icon style.** Import `FontAwesomeIcon` from the module your Vite
config already externalizes (`@fortawesome/react-fontawesome` →
`__XENTIUM_HOST__.FaReact`). Core swaps that export for its own wrapper, so on a site with
a FontAwesome Pro kit your icons are drawn in the site's chosen style.

If you bundle your own copy of that package, you quietly opt out: your icons stay solid
while the rest of the page changes. Keep it external.

**An admin can replace any single icon.** In the Layout Editor's Icons mode, every icon on
the page is clickable, and the replacement is stored on the block node (`iconOverrides`,
keyed `"<icon-name>#<n>"`, meaning the nth icon with that name your block drew, in render
order). You don't do anything; it's applied inside the wrapper.

The key is positional. If you later change how many icons **with the same name** your
block renders, an existing override can land on the one next to it. Adding an icon with a
*different* name is always safe, because the numbering is per name.

### An icon as a prop

When the icon is the admin's choice rather than part of your design, declare it and the
editor shows an icon picker:

```ts
const schema = z.object({
  icon: z.string().optional().meta({ title: "Icon", format: "icon" }),
});
```

`format: "icon"` is a hint the settings form understands; there's nothing to register.
Render it with `TokenIcon`, which tries the pinned style, then the site's style, then the
bundled free icon, and otherwise draws nothing:

```tsx
// Externalize it like the rest: it's `__XENTIUM_HOST__.webTokenIcon`.
import { TokenIcon } from "@web/components/TokenIcon";

component: ({ props }) => props.icon ? <TokenIcon token={props.icon} /> : null,
```

Keep it **optional, without a default**. No value means no icon. A default would put an
icon on every instance anyone ever creates.

More in [Icons](icon-kits.md).

## CSS handles

Besides the variant, an admin can give any block a **`className`**: their own handle for
custom CSS. It also sits on the `display: contents` wrapper, so your block gets it
without registering anything, without a prop, and without the class ever landing on an
element you position.

Your block also gets **`xt-b--<your-type>`** on that wrapper automatically. A dotted type
is flattened for the selector, so `myplugin.stats` becomes `.xt-b--myplugin-stats`. That's
the hook a downloaded theme uses to style your block, since a theme can't add handles to
layouts it doesn't control.

What that means for you:

- **Don't add a `className` prop of your own.** One already exists on the node, and a
  second would just duplicate it forever.
- **Give your block's real elements stable, prefixed classes**, because that's what a
  theme ends up selecting: `.xt-b--myplugin-stats .myplugin-stats__count`. Treat those
  class names as part of your block's public contract. Renaming one breaks themes just
  like renaming a prop would. Your block's *type* is part of that contract too now, since
  the class comes from it.
- **Never use `>`, `+` or `~` across a block boundary in your stylesheet.** The wrapper
  sits between a container and its children in the DOM, and selectors match the DOM even
  though the wrapper has no box. Use descendant selectors. We shipped this bug in core
  once, and it broke the mobile layout of every styled column.

## Data: core blocks vs plugin blocks

Core blocks **never fetch**. They get their data as props from a host container that
already ran the query and the permission checks, because a theme's document must not be
able to widen what a page shows.

Plugin blocks **can call their own endpoints**. A plugin is trusted code with its own
permission-checked routes, and core can't fetch your data for you. The rule stays the
same: the layout **document** grants nothing, and your API decides what the viewer gets.

```tsx
// Fine: your endpoint applies your visibility rules on the server.
const { data } = useQuery({ queryKey: ["my-block"], queryFn: () => api.get("/myplugin/items") });
```

**Don't** take an id or a filter from props and trust it. Props come from a layout
document, which an admin, or an imported theme, wrote.

## When your plugin is disabled

Nothing breaks and nothing is lost:

- The renderer **skips** the unknown block type and renders the rest of the page.
- The block **stays in the document**, so enabling the plugin again puts it back exactly
  where the admin placed it.
- In the ACP the node shows as *"Block `x` is unavailable"* instead of vanishing.

That's why stored layouts survive version and plugin changes. Don't work around it by
adding placeholder blocks to core.

## Opening your own pages to the Layout Editor

A block is something an admin places on a page core already owns. A **layout template**
is the other half: one of *your* pages, opened up so an admin can arrange it the same way.

Themes still can't add templates. A theme is data, and data must never be able to invent
a route. A plugin is code that already owns its routes, so declaring the regions of a
page it already renders doesn't give it anything new. It just lets the admin arrange that
page.

### Declare it once, register it twice

The server's registry decides what can be **saved** (it checks every draft and every
`.xttheme` import against your declared regions); the browser's decides what
**renders**. Share one declaration so the two can't disagree:

```ts
// shared/layoutTemplates.ts: imported by BOTH entries
import type { LayoutTemplateDeclaration } from "@xentium/plugin-sdk";

export const MY_INDEX: LayoutTemplateDeclaration = {
  key:      "myplugin.index",     // namespaced; a bare word is refused
  label:    "My index",           // shown in the editor's picker
  pluginId: "my-plugin",
  regions:  ["main", "aside"],    // the body and the rail beside it, like core's pages
  previewRoute: "/mypage",        // a same-origin path the ACP previews
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

Your page component becomes a **host container**: it resolves the document (and any data
its blocks need) and lets the document decide what goes where.

```tsx
import { LayoutRenderer } from "@web/layout/LayoutRenderer";
import { useLayoutDocument } from "@web/layout/useLayout";

export function MyIndexRoute() {
  const layout = useLayoutDocument("myplugin.index");
  return <LayoutRenderer templateKey="myplugin.index" document={layout} />;
}
```

**Externalize all three `@web/layout/*` imports** in your Vite config
(`templateRegistry`, `LayoutRenderer`, `useLayout`), the same way you externalize
`blockRegistry`. A bundled copy registers into its own registry, which the host never
reads, and your template silently won't exist.

### What gets refused

`registerTemplate` **throws** instead of warning, so a bad declaration fails the enable
rather than leaving your plugin half-registered. It refuses:

- a **core** template key (a plugin must never be able to redefine `home`);
- a key another plugin already registered (re-registering your own is fine, and happens
  on every enable);
- a key without a namespace;
- a `previewRoute` on another origin (it loads in an iframe in the ACP);
- no regions, a duplicate region, or a region name that isn't an identifier;
- a `defaultDocument` that wouldn't survive a save: the wrong template key, an undeclared
  region, a broken tree, or a missing required block.

### When your plugin is disabled

Same rule as for blocks, one level up. We deregister the template, so the editor stops
offering it and the public payload stops including it, but **we keep the stored
documents**. Enable the plugin again and the admin's arrangement is back.

A `.xttheme` that ships your template is skipped on a site without your plugin (there are
no declared regions to check it against), and the import reports it under
`unknownTemplates`. The admin can enable your plugin and import again.

### Variants are core-only for now

Per-instance layouts (like one custom page's own arrangement) are limited to core's
`VARIANT_TEMPLATES`, so a variant on a plugin template gets a 422. A variant needs a list
of *instances* for the editor's picker, and there's no way yet for a plugin to supply one.

## A real example

Our forum plugin does all of this. Its `forum.categories` block is backed by
`/forum/nodes`, an endpoint that filters by what each viewer may see, and its
`forum.index` template (`shared/layoutTemplates.ts`, `web/pages/ForumIndexRoute.tsx`,
`web/blocks/ForumIndexBlock.tsx`) is the whole template pattern end to end. The forum is
a paid plugin, so its source isn't in this repo.

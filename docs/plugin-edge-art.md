# Plugin edge art

Edge art is the decoration along a block's top or bottom edge: a slant, a wave, dripping
paint and so on. Core ships a set of shapes. A plugin can add its own shapes, keep its own
settings on an edge, draw the edge itself, and add sections to the Theme Studio inspector.

This page is the contract for doing that. For blocks, read [Plugin-authored layout
blocks](./plugin-blocks.md) first; the rules are the same in spirit.

## Externalize the two modules

Both modules must be the host's copies. A bundled registry is a Map nothing reads.

```ts
// vite.config.ts
const externals = {
  // …existing entries…
  "@web/layout/edgeRegistry": `${H}.webEdgeRegistry`,
  "@web/layout/edgeArt":      `${H}.webEdgeArt`,
};
```

Older hosts don't have them. Check before you register, so your plugin does nothing on a
host that can't draw it instead of failing to load:

```ts
if (window.__XENTIUM_HOST__?.webEdgeRegistry) {
  registerMyShapes();
}
```

## Registering a shape

A shape is either a repeating **unit** or one whole **path**. Both are drawn hanging down
from the top of a band `H` tall; we flip and stretch them for every other placement.

```ts
import { registerEdgeShape } from "@web/layout/edgeRegistry";
import { unitRand } from "@web/layout/edgeArt";

registerEdgeShape({
  id: "myplugin.spikes",          // <namespace>.<name>, like a block type
  pluginId: "xentium-myplugin",
  labelKey: "myplugin:shape.spikes",
  defaultCount: 20,
  seamless: false,                 // units vary, so no seamless loop
  fallback: "zigzag",              // what a site without your plugin draws
  unit: {
    base: (H) => H * 0.1,
    // One unit, drawn right to left from (x, base) to (x - w, base).
    unit: (x, w, H, i) => ` L ${x - w / 2} ${H * (0.5 + unitRand(i, 1) / 2)} L ${x - w} ${H * 0.1}`,
  },
});
```

The rules:

- **Namespace the id.** Core shapes have bare names. Yours are `<namespace>.<name>`.
- **A unit must be deterministic.** Use `unitRand(i, k)` for variation, never
  `Math.random()`. Every visitor's screen has to draw the same edge, and a unit that
  repeats exactly (`seamless: true`) lets an extension slide the band without a seam.
- **Give it a fallback.** The editor stores it on the edge when an admin picks your shape.
  A site without your plugin, including one that imported a theme using your shape, then
  draws that core shape instead of nothing.
- **Set `icon`** if a miniature of the outline wouldn't say what the shape is.

`registerEdgeShape` throws on a bad id or one that's taken. Let it: a plugin that fails
its enable loudly is better than one that half-registers.

## Your own settings: `ext`

Each edge has an `ext` object. Your settings live under your namespace, `ext.<namespace>`.
We don't validate what's inside; you parse it yourself when you draw, and ignore what you
can't read. We only cap its size (`EDGE_ART_LIMITS.ext` bytes for all plugins together),
and we keep it untouched while your plugin is off.

Parse with your own Zod schema, and treat a parse failure as "no settings":

```ts
const mySettings = z.object({ sparkle: z.boolean().optional() });
const read = (ext: unknown) => mySettings.safeParse(ext ?? {}).data;
```

Keep settings optional with no defaults. An edge saved before a setting existed has to
look exactly as it did.

## Drawing an edge yourself

Register an extension with a `render` function. We call it for every edge that's being
drawn; return `null` to leave the edge to core. The first extension that returns something
wins.

```tsx
import { registerEdgeExtension } from "@web/layout/edgeRegistry";
import { edgeClassName, edgeStyle, edgePlacement, edgeMask } from "@web/layout/edgeArt";

registerEdgeExtension({
  namespace: "myplugin",
  pluginId: "xentium-myplugin",
  render: ({ edge, side, ext, drawCore }) => {
    const settings = read(ext);
    if (!settings?.sparkle) return null;
    return (
      <>
        {drawCore()}
        <span className="xt-edge-layer my-sparkles" aria-hidden="true" style={edgePlacement(edge, side, false)}>
          …
        </span>
      </>
    );
  },
});
```

What you have to work with:

| Export | What it gives you |
|---|---|
| `drawCore()` | Core's drawing of this edge, to wrap or draw beside |
| `now` | The moment to draw for: the visitor's clock, or the date and hour the editor previews. Use it, never `new Date()`, for anything that follows the time |
| `edgeStyle(edge, side)` | The box's style: position, height, flip, opacity |
| `edgeClassName(edge, side)` | The box's classes. Use them on your own box |
| `edgePlacement(edge, side, mirror?)` | Position and flip only, for layers beside the box |
| `edgeMask(shape, H, W?, { count, phase })` | A shape as a CSS mask, any width, count or offset |
| `edgePaint(edge)` | The edge's colour or gradient |
| `resolveEdgeShape(edge)` | The shape that actually draws (its own, its fallback, or none) |

The rules:

- **Anything beside the box carries `xt-edge-layer`.** Some blocks position their own
  children; they leave `.xt-edge` and `.xt-edge-layer` alone. Without the class, your layer
  gets `position: relative` and lands in the wrong place.
- **Your own box uses `edgeClassName`.** Blocks look for `.xt-edge` (a section drops its
  corner clip for it), and the phone rules hang off it.
- **Decoration only.** `aria-hidden`, `pointer-events: none`, and hidden in forced colours.
- **Motion respects the visitor.** Anything that moves must stop under
  `prefers-reduced-motion`. Anything that is only motion (particles) should not draw there
  at all.
- **No stylesheet.** The host loads one script per plugin. Ship your CSS as a string and
  inject it, and write every colour as a core token or the edge's own colours.

## Art that follows the clock

If your settings change with the time of day, say so with `usesTime`, and draw from the
`now` you're handed:

```ts
registerEdgeExtension({
  namespace: "myplugin",
  pluginId: "xentium-myplugin",
  usesTime: (ext) => !!read(ext)?.nightMode,
  render: ({ ext, now, drawCore }) => (now.getHours() < 6 ? <Night /> : null),
});
```

When any edge in the open document answers yes, the editor shows **Viewing at** next to
the preview, so an admin can see any hour without waiting for it.

## Art for part of the year

Core edge art shows all year. If your plugin offers art that should only appear for part of
it (a holiday look, say), keep the dates in your own settings and tell the host two things:

- `shows` decides whether the edge is drawn at all at a given moment. Return `false` and
  the edge is gone: no box, no room kept for it. Every extension has to agree, so one
  that returns `false` hides the edge.
- `viewDate` names a day worth previewing, as `MM-DD`. When any edge in the open document
  names one, the editor offers **Viewing on** with that day, and `now` in `render` and
  `shows` follows it.

```ts
registerEdgeExtension({
  namespace: "myplugin",
  pluginId: "xentium-myplugin",
  shows: ({ ext, now }) => inMySeason(read(ext)?.season, now),
  viewDate: (ext) => read(ext)?.season?.from ?? null,
});
```

On a host from before these hooks, `shows` is never asked. If you want your art hidden
there too, return an empty fragment (`<></>`) from `render` outside your dates: anything
other than `null` stops the host drawing the edge itself.

## The member's rank colour

On a profile, the page sets `--xt-rank-color` to the member's rank colour (their first
group that has one). Art that should take it on can use `var(--xt-rank-color, <fallback>)`;
everywhere else the variable is absent and the fallback applies.

## Art without an outline

The core shape `blank` draws nothing. It exists for edges that only carry plugin art. When
an admin picks **None** on an edge that still has settings under `ext`, the editor keeps the
edge and sets its shape to `blank` instead of deleting it. If your settings become empty on a
`blank` edge, remove the edge (`write(undefined)`), so "None" with nothing on it really is
nothing.

## Inspector sections

An extension can add two sections to the Edge art panel:

- `InspectorTop`, above the shape picker. It shows even when the side has no edge yet,
  which is where presets belong.
- `Inspector`, below the core settings. It also shows on a side with **no edge yet**
  (`edge` is `undefined`), so art that needs no outline, like a sky, can be switched on
  straight away: create the edge with `write`, using the `blank` shape.

Both get the same props:

| Prop | |
|---|---|
| `edge` | The edge on the side being edited, or `undefined` |
| `ext` | Your settings (`edge.ext.<namespace>`), unparsed |
| `setExt(next)` | Replace your settings; `undefined` removes them |
| `write(edge)` | Replace the whole edge, for presets; `undefined` removes it |

Build the sections from core's classes so they match the panel around them:
`lay__props-section` for a heading, `lay__seg` for a segmented control (add
`lay-edge__wrap` if it wraps), `lay-edge__row`, `lay-edge__check`, `lay-edge__range`,
`lay-edge__chips` / `lay-edge__chip` for a row of presets, and `acp-hint` for help text.
Use `Toggle` from `@web/components/AcpControls`. Don't set a font, a weight or a size.

## When your plugin is off

Nothing an admin made is lost. An edge using your shape draws its fallback, or nothing,
and the panel tells the admin which plugin shape it is waiting for. Your `ext` settings stay
on every edge. Enable the plugin again and every edge is back the way it was.

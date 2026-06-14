# ADR 0004 — Site chrome composition (navbar / footer builder)

- **Status:** Proposed (capture the vision; build **after** ADR 0003 lands)
- **Date:** 2026-06-14
- **Relates to:** §50 (Frontend Nav Manager), §51 (Branding/Logo), §24 (style layer 3 — layout
  slots), §10/§54 (plugin UI slots), `apps/web/src/layouts/PubNav.tsx`, `SiteFooter.tsx`
- **Orthogonal to:** ADR 0003 (region/component **theming**). This ADR is **composition**, not colour.

## Context

The navbar and footer are currently hardcoded JSX. We want them **composable**: every chrome
element — logo, nav-links, search, theme toggle, notifications, admin tab, avatar dropdown, and
**plugin-contributed** widgets (e.g. the messaging plugin's PM icon) — should be a **draggable
widget** whose **placement and order are fully configurable** in the ACP. Same for the footer and
its components.

This is a **different axis** from theming:

- ADR 0003 = how chrome **looks** (tokens/colours).
- ADR 0004 = **what** chrome exists and **in what order** (layout/composition).

They stay two systems. Composition is the concrete first slice of §24's **layer-3 layout slots**
(the "v2 template system") and generalises three things we already have.

## Decision

### 1. Model: zones → ordered widgets

```jsonc
navbar: {
  left:   ["logo"],
  center: ["nav-links"],
  right:  ["search", "theme", "pm", "notifications", "admin", "avatar"]
}
footer: { columns: [ ["logo","tagline"], ["links:community"], ["online","socials"], ["copyright"] ] }
```

Each id resolves to a **widget** from a registry. Order + zone are persisted; the layout renders
from the model instead of fixed JSX.

### 2. Widget registry (core + plugin)

| Surface | Core widgets |
|---|---|
| Navbar | `logo`, `nav-links`, `search`, `theme`, `notifications`, `admin` (staff-only), `avatar` |
| Footer | `logo`, `tagline`, `links` (a link column), `online` (counter), `socials`, `copyright` |

Each `WidgetDef`:

```ts
interface WidgetDef {
  id: string; label: string; icon?: string;
  surface: "navbar" | "footer";
  allowedZones: string[];      // constrains drag targets (see Open decision 1)
  singleton: boolean;          // logo/avatar/search — cannot be added twice
  pluginId?: string;           // set for plugin widgets → auto-removed on disable
  defaultVisibility?: "public" | "members" | "groups";
  render: ComponentType;       // frontend component (core built-in; plugin via Vite slot, §54)
}
```

The frontend widget registry maps id → React component; core widgets are built-in, plugin widgets
arrive through the Phase-14 plugin entry-point / UI-slot mechanism (§54).

### 3. Plugins contribute widgets via plugin-sdk

```ts
// messaging plugin onEnable():
plugin.registerNavWidget({ id: "pm", label: "Messages", icon: "envelope",
  allowedZones: ["right"], singleton: true, render: PmIcon });
```

Plugin widgets are **auto-hidden when the plugin is disabled and removed on uninstall** — identical
to how plugin **nav links** (§50) and **ACP pages** (§54) already behave. A layout referencing a
missing widget simply skips it (and the ACP builder shows it greyed as "unavailable — plugin off").

### 4. Per-widget visibility (reuse §50)

Each placed widget carries a visibility rule reusing the existing model + `GroupAccessPicker`
(`public` / `members` / specific groups), on top of implicit widget rules (admin tab → staff).
So "hide search for guests" or "PM icon for members only" is the same control admins already know.

### 5. Storage + API

- `settings['appearance.navbar.layout']` and `settings['appearance.footer.layout']` — JSON:
  zones → ordered `[{ widgetId, visibility, config? }]`. (Small ordered structure → settings blob,
  not a table.)
- The `nav-links` widget keeps pulling from the existing **`nav_items`** table (§50) — the builder
  composes *widgets*; the links manager still edits the *links themselves*. Two levels, no overlap.
- API:
  - `GET /api/nav-layout` — public; resolved, visibility-filtered, ordered widgets for the viewer.
  - `GET|PUT /api/admin/nav-layout` — the builder (admin.access).
  - Seeded default layout written by the installer (like §50 default nav items); "Reset to default".

### 6. ACP builder + dynamic render

ACP → Appearance → **Layout** (sits beside §50 Navigation): drag-drop across zones (constrained by
`allowedZones`), toggle/visibility per widget, live preview strip. `PubNav` / `SiteFooter` are
rewritten to render `GET /api/nav-layout`.

### 7. Generalises what exists; feeds the v2 template system

- **§50 Nav Items** (links, already drag-drop) → links become *one widget* (`nav-links`).
- **plugin nav registration** → extends to `registerNavWidget` / `registerFooterWidget`.
- **§51 Branding/logo** → the logo becomes the `logo` widget.
- This is §24 **layer-3 (layout slots)** in concrete form — the entry point to the v2 template
  system, which later adds full template/layout *overrides* on top of the same widget model.

## Open decisions (pin before build)

1. **Zone freedom.** Recommend **constrained** via `allowedZones` (e.g. `logo`→left/center,
   `avatar`→right only, `nav-links`→any) rather than fully free — prevents broken layouts (avatar
   in the centre) while keeping real flexibility.
2. **Footer granularity.** Columns of widgets (recommended) vs a flat ordered list. Columns map to
   how footers actually look and to a responsive stack on mobile.
3. **Mobile.** A separate collapsed/hamburger layout, or derive from the desktop model
   (recommended: derive in v1, dedicated mobile ordering later).

## Schema / contract impact

- No DB migration: two new `settings` JSON blobs + seeding. `nav_items` (§50) unchanged.
- `plugin-sdk` gains `registerNavWidget` / `registerFooterWidget` (+ teardown on disable, reusing
  the existing plugin nav/ACP-page deregistration path).

## Consequences

- Navbar/footer become data-driven and **plugin-extensible** — core to the plugin ecosystem (PM is
  the first real consumer).
- `PubNav` / `SiteFooter` render from a model (a deliberate rewrite — hence sequence after 0003).
- Theming (0003) and composition (0004) compose cleanly: a widget is *placed* by 0004 and *coloured*
  by 0003's region/component tokens.

## Phased delivery

1. **Widget registry + layout model + `GET /api/nav-layout`** + render `PubNav` from it (core
   widgets only; footer still static). Behaviour-preserving (seed = today's order).
2. **ACP Layout builder** (drag-drop, visibility) + `SiteFooter` from model.
3. **plugin-sdk `registerNavWidget`/`registerFooterWidget`** + messaging **PM** widget as the proof.

*Build order: ADR 0003 (theming) ships first; this is picked up after.*

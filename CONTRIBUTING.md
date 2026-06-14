# Contributing to Nodevo

Thanks for helping build Nodevo! This page is the short version — the
[README](./README.md) has full setup, architecture, and the plugin development
guide.

## Getting set up

See **[README → Quick start](./README.md#quick-start)**. In short:

```bash
corepack enable && pnpm install
cp .env.example .env        # fill in the secrets (README → Environment configuration)
pnpm db:generate
./nodevo.sh                    # infra + api + worker + web → http://localhost:5173
```

## Workflow

1. Branch off **`development`** (not `main`).
2. Make a focused change. Before pushing, **`pnpm backbone:check`** must be green
   (typecheck + lint + test + build).
3. Open a PR to `development`. Fill in the PR template's merge-readiness checklist.

## Ground rules

These are enforced in review (and most are in the PR template):

- **Validate all input with Zod** — body, params, query, env/config, plugin
  manifests. No endpoint touches `req.body`/`req.params`/`req.query` unvalidated.
- **Security lives on the backend** — permission and license checks run server-side;
  UI checks are cosmetic only.
- **Keep the module shape** — `routes → controller → service → repository`, plus
  `validation`, `types`, `tests`. Shared types/DTOs/permission keys go in
  `@nodevo/contracts`; shared runtime helpers in `@nodevo/sdk`.
- **Don't blur core and plugins** — official add-ons live in a **plugin**, never in
  core. Core must stay fully usable with no premium plugin installed.
- **Core never hardcodes a plugin** — no plugin table names, ids, or routes in core.
  Plugins contribute through registries (search, home feed, nav, ACP, …) and core
  iterates whatever's registered.
- **Schema changes ship with a migration** in the same PR, applying cleanly on a
  fresh DB.

## Theming tokens

All visual values are **CSS custom properties** — never hardcode a colour, radius,
or shadow in a component. The token system has three tiers, all defined in
`apps/web/src/styles/tokens.scss`:

| Tier | Prefix | Example | Edit when |
|---|---|---|---|
| **Semantic** (the palette) | `--c-*` | `--c-accent`, `--c-bg`, `--c-fg`, `--c-card` | adding a base colour role |
| **Region** | `--<region>-*` | `--nav-bg`, `--footer-bg`, `--content-bg`, `--aside-bg` | a page area needs its own surface |
| **Component** | `--<component>-*` | `--btn-bg`, `--card-bg`, `--input-bg`, `--menu-bg` | an element type needs its own value |

**Tokens aren't colour-only** — each surface exposes its full set of facets: fill,
border (`--card-border-color`, width/style, per-side long-hands), radius
(`--card-radius`), and shadow (`--card-shadow`).

### Inheritance — the one rule that keeps it consistent

Region and component tokens **default to a semantic token**, e.g.:

```scss
--nav-bg:  var(--c-surface);   /* navbar follows the surface colour … */
--btn-bg:  var(--c-accent);    /* buttons follow the accent … */
```

So changing a semantic token cascades everywhere automatically. Only set a
region/component token explicitly when that surface genuinely needs to differ.

### Per-region scoping (no token explosion)

Because CSS custom properties inherit down the DOM, a region can re-scope a
**component** token on its own root element — no new token names needed:

```scss
.btn-primary { background: var(--btn-bg); }  /* component reads the token */
.pub-nav     { --btn-bg: #fff; }              /* navbar re-scopes it → only buttons in the nav */
```

### Adding a token

1. Add the `TokenDef` to the registry: `packages/contracts/src/tokens.ts` (the
   single source of truth — `kind`, `group`, `inheritsFrom`, etc.).
2. Define it in `apps/web/src/styles/tokens.scss`, defaulting to its semantic base
   (`--my-token: var(--c-…)`).
3. Reference `var(--my-token)` in the component SCSS — never a literal value.

## Contributing a plugin

The full guide is in **[README → Plugin development guide](./README.md#plugin-development-guide)**.
Put work-in-progress plugins under `plugins/community-examples/<name>/` (a pnpm
workspace member), wire HMR via `apps/web/src/plugins/dev-plugins.ts`, and install
them from **ACP → Extensions → Upload**. Package for distribution with
`pnpm plugin:package` (produces a `.nvplugin`).

## Reporting issues

Open a GitHub issue with steps to reproduce, expected vs actual behavior, and the
relevant **NEC error code** if one was shown — it pins down the failing domain fast.

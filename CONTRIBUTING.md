# Contributing to Xentium

Thanks for helping build Xentium! This page is the short version — the
[README](./README.md) has full setup, architecture, and the plugin development
guide.

## Getting set up

See **[README → Quick start](./README.md#quick-start)**. In short:

```bash
corepack enable && pnpm install
cp .env.example .env        # fill in the secrets (README → Environment configuration)
pnpm db:generate
./xentium.sh                    # infra + api + worker + web → http://localhost:5173
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
  `@xentium/contracts`; shared runtime helpers in `@xentium/sdk`.
- **Don't blur core and plugins** — official add-ons live in a **plugin**, never in
  core. Core must stay fully usable with no premium plugin installed.
- **Core never hardcodes a plugin** — no plugin table names, ids, or routes in core.
  Plugins contribute through registries (search, home feed, nav, ACP, …) and core
  iterates whatever's registered.
- **Schema changes ship with a migration** in the same PR, applying cleanly on a
  fresh DB.

## Theming tokens

All visual values are **CSS custom properties** — **never hardcode a colour, radius,
or shadow**; always reference a token. Three tiers (defined in
`apps/web/src/styles/tokens.scss`, contract in `@xentium/contracts` → `TOKEN_REGISTRY`):
semantic `--c-*` → region `--nav-*`/`--footer-*`/… → component `--btn-*`/`--card-*`/…,
each defaulting to its semantic base so palette edits cascade.

**To add a token:** add a `TokenDef` to `packages/contracts/src/tokens.ts`, define it in
`tokens.scss` defaulting to its semantic base (`--my-token: var(--c-…)`), then reference
`var(--my-token)` in the SCSS.

Full contract — tiers, naming, inheritance, per-region scoping, and the `GET /css` output
shape — is in **[docs/API.md → Theming tokens & scoped CSS](./docs/API.md#theming-tokens--scoped-css)**.

## Contributing a plugin

The full guide is in **[README → Plugin development guide](./README.md#plugin-development-guide)**.
Put work-in-progress plugins under `plugins/community-examples/<name>/` (a pnpm
workspace member), wire HMR via `apps/web/src/plugins/dev-plugins.ts`, and install
them from **ACP → Extensions → Upload**. Package for distribution with
`pnpm plugin:package` (produces a `.nvplugin`).

### Plugin foundation (extension points)

Plugins never patch core — they **register** into it. Authoring contracts live in
`@xentium/plugin-sdk`; the web host bridges shared singletons through
`window.__XENTIUM_HOST__` so a plugin's UMD bundle reuses the host's React, router,
and i18next rather than shipping its own.

- **Translated UI strings** — bundle `web/locales/<lng>/<ns>.json` (en, de, es, fr,
  pt) and register them with `registerPluginTranslations` (externalized as
  `@web/plugins/pluginI18n`); then `useTranslation("<ns>")` as usual. Translations
  travel inside the web bundle — no HTTP fetch, no server packaging. Full recipe:
  **[docs/plugin-i18n.md](./docs/plugin-i18n.md)**.
- **Web slots** (`apps/web/src/plugins/slotRegistry.ts`) — contribute UI via
  `registerRoute`, `registerAcpPage`, `registerModCanvasSection`,
  `registerUserDetailPanel`, `registerIpEnrichment`, etc. Core iterates whatever's
  registered; slots are auto-deregistered when the plugin disables.
- **Server hooks** (`@xentium/plugin-sdk` → `PluginContext` / `PluginHost`) —
  `ctx.registerRoutes` / `registerPermissions` / `registerNecCodes`, and
  `ctx.registerSecurityScan(fn)` for periodic detection run by the core
  security-analysis job. Core moderation primitives are exposed on
  `host.security` (`createCase`, `autoBanMultiaccounts`) so a plugin can open
  review cases or enforce without reaching into core internals.

The rule still holds: **core stores and exposes; the plugin treats.** Core keeps the
telemetry, case tables, and cadence; detection logic and review UI belong in the
plugin.

## Reporting issues

Open a GitHub issue with steps to reproduce, expected vs actual behavior, and the
relevant **XEC error code** if one was shown — it pins down the failing domain fast.

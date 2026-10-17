# Contributing to Xentium

Thanks for helping out! This is the short version. The [README](./README.md) has the
full setup, the architecture and the plugin guide, and everything is also on
[doc.xentium.org](https://doc.xentium.org).

## Getting set up

See **[README → Quick start](./README.md#quick-start)**. In short:

```bash
corepack enable && pnpm install
./xentium.sh                # infra + api + worker + web → http://localhost:5173
```

The first time you open the site, the install wizard writes `.env` for you. If you'd
rather write it yourself, see [README → Environment configuration](./README.md#environment-configuration).

## How we work

1. Branch off **`development`**, not `main`.
2. Keep the change focused. Before you push, **`pnpm backbone:check`** has to pass
   (typecheck + lint + test + build).
3. Open a PR against `development` and fill in the checklist in the PR template.
   The **Checks** workflow runs the same `backbone:check` on every PR. A first-time
   contributor's run starts once a maintainer approves it.

## Ground rules

We check these in review, and most of them are in the PR template:

- **Validate all input with Zod:** body, params, query, env/config and plugin
  manifests. No endpoint reads `req.body`, `req.params` or `req.query` unvalidated.
- **Security lives on the backend.** Permission and licence checks run on the server.
  Hiding a button in the UI is cosmetic.
- **Keep the module shape:** `routes → controller → service`, plus `validation`, `types`
  and `tests`. Add a `repository` only when a query is shared or complex. Shared
  types, DTOs and permission keys go in `@xentium/contracts`, shared runtime helpers in
  `@xentium/sdk`.
- **Keep core and plugins apart.** Official add-ons are plugins, never core, and core
  has to work fully without any paid plugin installed.
- **Core never hardcodes a plugin.** No plugin table names, ids or routes in core.
  Plugins add things through registries (search, home feed, nav, ACP, …) and core loops
  over whatever is registered.
- **Schema changes ship with a migration** in the same PR, and it has to apply cleanly
  to a fresh database.

## Theming tokens

Every visual value is a **CSS custom property**. Don't hardcode a colour, radius or
shadow; reference a token. There are three tiers, defined in
`apps/web/src/styles/tokens.scss` and described for code in `TOKEN_REGISTRY`
(`@xentium/contracts`): semantic `--c-*`, then region `--nav-*`/`--footer-*`/…, then
component `--btn-*`/`--card-*`/…. Each one defaults to the tier above it, so changing
the palette changes everything.

**To add a token:** add a `TokenDef` to `packages/contracts/src/tokens.ts`, define it in
`tokens.scss` with a default from the tier above (`--my-token: var(--c-…)`), then use
`var(--my-token)` in your SCSS.

How tokens, layers and themes fit together is in
**[docs/style-system.md](./docs/style-system.md)**. The details of the stylesheet the API
serves are in **[docs/API.md → Theming tokens & scoped CSS](./docs/API.md#theming-tokens--scoped-css)**.

## Contributing a plugin

The full guide is in **[README → Plugin development guide](./README.md#plugin-development-guide)**.
Put a plugin you're working on in `plugins/community-examples/<name>/` (it's a pnpm
workspace member), wire up hot reload in `apps/web/src/plugins/dev-plugins.ts`, and
install it from **ACP → Extensions → Installed → Upload** (switch on "Allow uploads" there first). `pnpm plugin:package` builds the
`.xtplugin` you distribute.

### Extension points

Plugins never patch core. They **register** things into it. The authoring contracts are
in `@xentium/plugin-sdk`. On the web side the host shares its singletons through
`window.__XENTIUM_HOST__`, so your plugin's UMD bundle uses the host's React, router and
i18next instead of shipping its own.

- **Translations:** bundle `web/locales/<lng>/<ns>.json` (en, de, es, fr, pt) and register
  them with `registerPluginTranslations` (externalized as `@web/plugins/pluginI18n`),
  then call `useTranslation("<ns>")` as usual. The translations travel inside your web
  bundle, so there's no fetch and nothing to package on the server. Full recipe:
  **[docs/plugin-i18n.md](./docs/plugin-i18n.md)**.
- **Web slots** (`apps/web/src/plugins/slotRegistry.ts`): add UI with `registerRoute`,
  `registerAcpPage`, `registerModCanvasSection`, `registerUserDetailPanel`,
  `registerIpEnrichment` and friends. Core renders whatever is registered, and your
  slots go away when the plugin is disabled.
- **Server hooks** (`@xentium/plugin-sdk` → `PluginContext` / `PluginHost`):
  `ctx.registerRoutes`, `registerPermissions`, `registerNecCodes`, and
  `ctx.registerSecurityScan(fn)` for a periodic scan that core's security-analysis job
  runs. Core's moderation tools are on `host.security` (`createCase`,
  `autoBanMultiaccounts`), so a plugin can open review cases or enforce without
  reaching into core.

One rule sums it up: **core stores and exposes, the plugin decides.** Core keeps the
telemetry, the case tables and the schedule; detection logic and review UI belong in
the plugin.

## Reporting issues

Open a GitHub issue with the steps to reproduce, what you expected and what happened,
and the **XEC error code** if you saw one. The code tells us straight away which part
of the system failed.

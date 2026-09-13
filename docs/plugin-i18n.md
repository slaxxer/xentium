# Plugin i18n (§60.7)

How an official/community plugin ships its own translated UI strings in all
bundled languages (en, de, es, fr, pt). Built June 2026 — see the
`nodevo-advanced-moderation` plugin for a live example (namespace `advmod`).

## Model

The plugin **bundles** its locale JSON into its web bundle and registers it into
the host i18next instance on load. No HTTP fetch, no server packaging — the
translations travel with `web/dist/index.umd.js`. The plugin owns a **namespace**
(use the plugin id or a short slug, e.g. `forum`, `messaging`, `advmod`).

A plugin may also reuse a **core** namespace (e.g. `acp`) when the strings already
exist there — that needs no locale files at all (the cases UI does this).

## Recipe

1. **Locale files** — one JSON per language, keyed by your namespace:

   ```
   web/locales/en/<ns>.json
   web/locales/de/<ns>.json
   web/locales/es/<ns>.json
   web/locales/fr/<ns>.json
   web/locales/pt/<ns>.json
   ```

   ```json
   // web/locales/en/forum.json
   { "thread": { "reply": "Reply", "solved": "Solved" } }
   ```

2. **Externalize the bridge** in `vite.config.ts` (alongside the others):

   ```ts
   "@web/plugins/pluginI18n": `${H}.webPluginI18n`,
   ```

3. **Dev deps for typecheck** (externalized at runtime, only tsc needs the types):

   ```jsonc
   // package.json devDependencies
   "i18next": "^26.2.0",
   "react-i18next": "^17.0.8"
   ```
   then `pnpm install --filter <your-plugin>`. (`web/tsconfig.json` already has
   `resolveJsonModule: true`.)

4. **Register** in `web/index.tsx`, before any UI renders:

   ```ts
   import { registerPluginTranslations } from "@web/plugins/pluginI18n";
   import en from "./locales/en/forum.json";
   import de from "./locales/de/forum.json";
   // …es, fr, pt
   registerPluginTranslations({
     en: { forum: en }, de: { forum: de },
     es: { forum: es }, fr: { forum: fr }, pt: { forum: pt },
   });
   ```

5. **Use it** in components:

   ```tsx
   import { useTranslation } from "react-i18next";
   const { t } = useTranslation("forum");
   return <button>{t("thread.reply")}</button>;
   ```

Missing keys fall back to `en` (i18next `fallbackLng`). Switching the UI language
needs no re-fetch — all bundled languages are registered up front. Cross-namespace
keys work with the `ns:` prefix, e.g. `t("common:actions.cancel")`.

## What core provides
- `apps/web/src/plugins/pluginI18n.ts` → `registerPluginTranslations(resources)`
  (`resources` = `{ [lng]: { [ns]: { …keys } } }`), bridged as
  `window.__XENTIUM_HOST__.webPluginI18n`.
- `react-i18next` itself is bridged (`ReactI18next`) so the plugin shares the host
  i18next instance + its loaded namespaces.

## Not covered (yet)
Server-side i18n for plugin **emails / notifications** (the §60.9 backend path) is
separate and not built. This doc is the **web** UI string mechanism only.

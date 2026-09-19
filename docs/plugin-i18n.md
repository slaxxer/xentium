# Translating a plugin

This is how a plugin ships its own translated UI strings in every language we bundle
(en, de, es, fr, pt). For a working example, look at the `xentium-advanced-moderation`
plugin (namespace `advmod`).

## How it works

Your plugin **bundles** its locale JSON into its web bundle and registers it with the
host's i18next instance when it loads. There's no HTTP fetch and nothing to package on
the server; the translations travel inside `web/dist/index.umd.js`. Your plugin owns a
**namespace**. Use the plugin id or a short slug, e.g. `forum`, `messaging`, `advmod`.

If the strings you need already exist in a **core** namespace (e.g. `acp`), you can
just use that one and skip the locale files entirely. Our moderation cases UI does this.

## Step by step

1. **Add the locale files**, one JSON per language, named after your namespace:

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

2. **Externalize the bridge** in `vite.config.ts`, next to the others:

   ```ts
   "@web/plugins/pluginI18n": `${H}.webPluginI18n`,
   ```

3. **Add the dev dependencies for typechecking.** They're externalized at runtime, so
   only `tsc` needs them:

   ```jsonc
   // package.json devDependencies
   "i18next": "^26.2.0",
   "react-i18next": "^17.0.8"
   ```

   Then run `pnpm install --filter <your-plugin>`. (`web/tsconfig.json` already has
   `resolveJsonModule: true`.)

4. **Register them** in `web/index.tsx`, before any UI renders:

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

5. **Use them** in your components:

   ```tsx
   import { useTranslation } from "react-i18next";
   const { t } = useTranslation("forum");
   return <button>{t("thread.reply")}</button>;
   ```

A missing key falls back to English (i18next's `fallbackLng`). Switching the UI language
doesn't fetch anything, because every language is registered up front. To use a key from
another namespace, prefix it: `t("common:actions.cancel")`.

## What core gives you

- `registerPluginTranslations(resources)` in `apps/web/src/plugins/pluginI18n.ts`, where
  `resources` is `{ [lng]: { [ns]: { …keys } } }`. It's exposed as
  `window.__XENTIUM_HOST__.webPluginI18n`.
- `react-i18next` itself is shared too (`ReactI18next`), so your plugin uses the host's
  i18next instance and everything it has already loaded.

## What's not covered yet

Translating a plugin's **emails and notifications** on the server is a separate thing,
and we haven't built it for plugins yet. This page is only about strings in the web UI.

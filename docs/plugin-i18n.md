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

## Text core shows for you

Some of your text is drawn by core, not by your components: permission names, your ACP
menu entries, your nav link, your layout template and your blocks with their settings.
You register these in English (in `onEnable()` or `registerBlock`), and core looks for a
translation under `host` in your namespace. The tree mirrors core's own, and a key
with dots (a permission, a block type) nests by its dots:

```json
// web/locales/de/forum.json
{
  "host": {
    "permissions": { "forum": { "thread": { "create": "Forenthemen erstellen" } } },
    "domains":     { "Forum": "Forum" },
    "acpSections": { "Forum": "Forum" },
    "acpPages":    { "forum/categories": "Kategorien" },
    "nav":         { "forum": "Forum" },
    "templates":   { "forum": { "index": "Forenübersicht" } },
    "blocks": {
      "forum": {
        "topUsers": {
          "label": "Forum: aktivste Mitglieder",
          "props": {
            "defaultMetric": { "title": "Zuerst angezeigter Wert", "enum": { "threads": "Themen" } }
          }
        }
      }
    }
  }
}
```

- `domains` is the permission group, by the `domain` you registered. `acpSections` is
  the `section` of `registerAcpPage`, and `acpPages` is its `path` without `/admin/`.
- `nav` is your nav link's URL without the leading `/`. It translates only while the
  link still has the label you registered; once an admin renames it, their name shows.
- Anything you leave out shows your English, so you can add these a few at a time.

## Labels you register in code

Slot labels (`registerProfileTab`, `registerSearchTab`, `registerGroupConfigPanel`, …)
are read when core renders them, so make them getters:

```ts
const ft = (key: string) => getI18n().t(`forum:${key}`);
slotRegistry.registerProfileTab({ id: "forum", get label() { return ft("slots.profileTab"); }, component: ForumProfileTab });
```

## Notifications

A notification you send keeps its English `title` and `body`, which are stored and used
for emails. Add `i18n` and the bell shows it in the reader's language:

```ts
await ctx.notify({
  userId, type: "forum.thread_approved", channels: ["in_app"],
  title: "Your thread was approved",
  body:  `"${thread.title}" has been approved.`,
  i18n:  { key: "forum:notify.approved", params: { title: thread.title } },
});
```

The bell reads `<key>.title` and `<key>.body`, filled in from `params`. When the body is
someone's own words (a message, a moderator's reason), leave `.body` out of your locale
files and the stored body shows as written.

## Dates and numbers

Format with the reader's language, not the browser's: pass `getI18n().language` to
`toLocaleString`, `toLocaleDateString` and `toLocaleTimeString`. For short ages ("5m",
"2d"), use core's texts: `t("common:time.m", { n })`, `common:time.h`, `common:time.d`,
`common:time.agoM` and the rest.

## What's not covered yet

Notification **emails** are still sent in English. This page covers the web UI and the
bell.

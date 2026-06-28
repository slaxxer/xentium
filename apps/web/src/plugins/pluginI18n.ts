import i18n from "../lib/i18n";

/**
 * Plugin translation registration (§60.7).
 *
 * A plugin ships its own locale JSON (one namespace, all bundled languages),
 * imports them in its web entry, and registers them into the host i18next
 * instance via this helper — exposed to plugins through the host bridge
 * (`window.__NODEVO_HOST__.webPluginI18n`). Because the bundles are added before
 * the plugin's UI renders, `useTranslation("<pluginNs>")` resolves immediately
 * with no `/locales` HTTP fetch (so no 404 for a namespace core doesn't own).
 *
 * Resources are shaped `{ [lng]: { [namespace]: { ...keys } } }`. Register every
 * bundled language so switching the UI language needs no re-fetch; missing keys
 * fall back to `en` (i18next `fallbackLng`).
 *
 * Example (in a plugin's web/index.tsx):
 *
 *   import en from "./locales/en/forum.json";
 *   import de from "./locales/de/forum.json";
 *   // …es, fr, pt
 *   registerPluginTranslations({
 *     en: { forum: en }, de: { forum: de },
 *     es: { forum: es }, fr: { forum: fr }, pt: { forum: pt },
 *   });
 *
 * then in components: `const { t } = useTranslation("forum");`
 */
export type PluginTranslations = Record<string, Record<string, Record<string, unknown>>>;

export function registerPluginTranslations(resources: PluginTranslations): void {
  for (const [lng, namespaces] of Object.entries(resources)) {
    for (const [ns, bundle] of Object.entries(namespaces)) {
      // deep = true (merge nested), overwrite = true (plugin owns its namespace).
      i18n.addResourceBundle(lng, ns, bundle, true, true);
    }
  }
}

// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// The developer wiki — https://doc.xentium.org. Static output, served by nginx.
// Most pages are GENERATED from the repo's docs by scripts/sync-docs.mjs (see there
// for the allowlist); hand-written pages live in src/content/docs/{index.mdx,admin/}.
export default defineConfig({
  site: "https://doc.xentium.org",
  // The bundled telemetry would phone home from every build.
  telemetry: false,
  integrations: [
    starlight({
      title: "Xentium Docs",
      description: "Documentation for Xentium — the open-source, extensible CMS & community platform: running it, building on it, and switching to it.",
      logo: {
        light: "./src/assets/xentium-lockup-light.svg",
        dark: "./src/assets/xentium-lockup-dark.svg",
        replacesTitle: true,
      },
      favicon: "/favicon.svg",
      components: { PageTitle: "./src/components/PageTitle.astro" },
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/slaxxer/xentium" }],
      // The product's own type: Figtree for text, Bricolage Grotesque for headings,
      // JetBrains Mono for code. Bundled, never loaded from a font CDN.
      customCss: [
        "@fontsource/figtree/400.css",
        "@fontsource/figtree/500.css",
        "@fontsource/figtree/600.css",
        "@fontsource/figtree/700.css",
        "@fontsource/bricolage-grotesque/600.css",
        "@fontsource/bricolage-grotesque/700.css",
        "@fontsource/bricolage-grotesque/800.css",
        "@fontsource/jetbrains-mono/400.css",
        "@fontsource/jetbrains-mono/700.css",
        "./src/styles/xentium.css",
      ],
      lastUpdated: false,
      // Grouped by who is reading: running a site, building on it, switching to it.
      sidebar: [
        { label: "Start here", items: [{ autogenerate: { directory: "start" } }] },
        { label: "Run Xentium", items: [{ autogenerate: { directory: "admin" } }] },
        {
          label: "Build on Xentium",
          items: [
            { label: "Concepts",         collapsed: true, items: [{ autogenerate: { directory: "concepts" } }] },
            { label: "Plugins",          collapsed: true, items: [{ autogenerate: { directory: "plugins" } }] },
            { label: "Themes & styling", collapsed: true, items: [{ autogenerate: { directory: "themes" } }] },
            { label: "Working on core",  collapsed: true, items: [{ autogenerate: { directory: "core" } }] },
          ],
        },
        // switch/ is hand-written (comparisons); guides/ is generated (the migration tool).
        {
          label: "Switch to Xentium",
          items: [{ autogenerate: { directory: "switch" } }, { autogenerate: { directory: "guides" } }],
        },
        { label: "Reference", collapsed: true, items: [{ autogenerate: { directory: "reference" } }] },
        { label: "Contributing", link: "/contributing/" },
      ],
    }),
  ],
});

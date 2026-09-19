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
      description: "Developer documentation for Xentium — the open-source, extensible CMS & community platform.",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/slaxxer/xentium" }],
      customCss: ["./src/styles/xentium.css"],
      lastUpdated: false,
      sidebar: [
        { label: "Start here",       items: [{ autogenerate: { directory: "start" } }] },
        { label: "Concepts",         items: [{ autogenerate: { directory: "concepts" } }] },
        { label: "Plugins",          items: [{ autogenerate: { directory: "plugins" } }] },
        { label: "Themes & styling", items: [{ autogenerate: { directory: "themes" } }] },
        { label: "Working on core",  items: [{ autogenerate: { directory: "core" } }] },
        { label: "Server admins",    items: [{ autogenerate: { directory: "admin" } }] },
        { label: "Guides",           items: [{ autogenerate: { directory: "guides" } }] },
        { label: "Reference",        items: [{ autogenerate: { directory: "reference" } }] },
        { label: "Contributing",     link: "/contributing/" },
      ],
    }),
  ],
});

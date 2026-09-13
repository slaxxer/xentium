import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/**
 * Dev parity for production SEO serving (apps/api/src/app/serveWeb.ts): injects
 * the canonical + Open Graph tags into the served index.html using the site URL
 * configured during install, so `view-source` / unfurlers see them on :5173 too.
 * Best-effort — silently no-ops if the API is down or the site isn't installed.
 */
function seoMetaDev(): Plugin {
  return {
    name: "xentium-seo-meta-dev",
    apply: "serve",
    transformIndexHtml: {
      order: "post",
      async handler(html, ctx) {
        try {
          const res = await fetch("http://localhost:4000/api/site/config", {
            signal: AbortSignal.timeout(800),
          });
          if (!res.ok) return html;
          const cfg = (await res.json()) as { siteUrl?: string; siteName?: string };
          const base = (cfg.siteUrl ?? "").replace(/\/+$/, "");
          if (!base) return html;
          const pathname = (ctx.originalUrl ?? "/").split("?")[0];
          const href = new URL(pathname, base + "/").toString();
          const name = cfg.siteName || "Xentium";
          // Swap the static <title> to the site name (parity with the prod
          // serveWeb.ts path) so view-source shows the configured name. Escape
          // the raw string replace (Vite auto-escapes the tag attrs below).
          const safeName = name.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          const titled = html.replace(/<title>[^<]*<\/title>/i, `<title>${safeName}</title>`);
          return {
            html: titled,
            tags: [
              { tag: "link", attrs: { rel: "canonical", href }, injectTo: "head" },
              { tag: "meta", attrs: { property: "og:url", content: href }, injectTo: "head" },
              { tag: "meta", attrs: { property: "og:type", content: "website" }, injectTo: "head" },
              { tag: "meta", attrs: { property: "og:site_name", content: name }, injectTo: "head" },
              { tag: "meta", attrs: { property: "og:title", content: name }, injectTo: "head" },
              { tag: "meta", attrs: { name: "twitter:card", content: "summary" }, injectTo: "head" },
            ],
          };
        } catch {
          return html; // API unreachable / pre-install — leave the head untouched
        }
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), seoMetaDev()],
  resolve: {
    alias: {
      "@web/lib":        resolve(__dirname, "src/lib"),
      "@web/hooks":      resolve(__dirname, "src/hooks"),
      "@web/plugins":    resolve(__dirname, "src/plugins"),
      "@web/components": resolve(__dirname, "src/components"),
      "@web/layout":     resolve(__dirname, "src/layout"),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: { "/api": "http://localhost:4000", "/uploads": "http://localhost:4000" },
  },
  optimizeDeps: { exclude: ["@xentium/ui", "@xentium/contracts", "@xentium/sdk"] },
});

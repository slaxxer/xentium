import express, { type Express, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { env, isProd } from "../config/env.js";
import { getSettings } from "../shared/utils/settings.js";

/** Escapes a string for safe interpolation into a double-quoted HTML attribute. */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Injects canonical + Open Graph tags into the served index.html so link
 * unfurlers and non-JS crawlers see the admin-configured site URL (settings
 * `site.url`). The client-side CanonicalManager only sets these in the live
 * DOM, which JS-less consumers never execute — mirror its convention here:
 * canonical uses the clean pathname only (no query string).
 */
export function injectSeoMeta(
  html: string,
  opts: { base: string; siteName: string; pathname: string },
): string {
  const base = opts.base.replace(/\/+$/, "");
  if (!base) return html; // site URL not configured yet (pre-install) — leave head untouched

  let href: string;
  try {
    href = new URL(opts.pathname, base + "/").toString();
  } catch {
    return html; // malformed site URL — don't write a broken canonical
  }

  const hrefAttr = escapeAttr(href);
  const nameAttr = escapeAttr(opts.siteName || "Xentium");
  const tags = [
    `<link rel="canonical" href="${hrefAttr}" />`,
    `<meta property="og:url" content="${hrefAttr}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${nameAttr}" />`,
    `<meta property="og:title" content="${nameAttr}" />`,
    `<meta name="twitter:card" content="summary" />`,
  ].join("\n    ");

  // Swap the static <title> to the configured site name so unfurlers that read
  // <title> get the real name rather than the build-time "Xentium" placeholder.
  const titled = html.replace(/<title>[^<]*<\/title>/i, `<title>${nameAttr}</title>`);
  return titled.replace(/<\/head>/i, `    ${tags}\n  </head>`);
}

// Match every path the SPA owns — i.e. everything except the API and uploads,
// which are handled by their own routers. (Express 5 requires a RegExp here;
// a bare "*" is no longer a valid route pattern.)
const SPA_PATH = /^\/(?!(api|uploads)(\/|$)).*/;

/**
 * In production the API serves the built SPA (apps/web/dist) so it can inject
 * per-request SEO meta from the site settings. Mounted BEFORE installGuard so
 * the installer page and its assets still load on a fresh, uninstalled
 * instance. Self-skips when no build exists (dev: Vite owns the frontend).
 */
export function mountWebApp(app: Express): void {
  // Dev keeps the API port pure (Vite owns the frontend on :5173) unless a dev
  // explicitly opts into prod-style serving via WEB_DIST — otherwise a stale
  // build would be served on :4000. Prod always serves from the default dist.
  if (!isProd && !env.WEB_DIST) return;

  const webDist = env.WEB_DIST
    ? path.resolve(env.WEB_DIST)
    : path.resolve(env.REPO_ROOT, "apps/web/dist");
  const indexPath = path.join(webDist, "index.html");

  if (!fs.existsSync(indexPath)) return; // no build — leave web serving to Vite/dev

  const template = fs.readFileSync(indexPath, "utf8");

  // Content-hashed build assets — safe to cache hard (Vite fingerprints names).
  app.use(
    express.static(webDist, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );

  // SPA fallback: serve index.html (with injected SEO meta) for all app routes.
  app.get(SPA_PATH, (req: Request, res: Response) => {
    void (async () => {
      try {
        const s = await getSettings({ "site.url": "", "site.name": "Xentium" });
        const base = typeof s["site.url"] === "string" ? s["site.url"] : "";
        const siteName = typeof s["site.name"] === "string" ? s["site.name"] : "Xentium";
        const html = injectSeoMeta(template, { base, siteName, pathname: req.path });
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache"); // per-request canonical; keep fresh
        res.send(html);
      } catch {
        // DB unreachable (e.g. pre-migrate) — still serve the shell so the
        // installer can load and the site never hard-fails on a meta lookup.
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.send(template);
      }
    })();
  });
}

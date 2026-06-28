import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useSiteConfig } from "../hooks/useSiteConfig";

/** Ensures a single <head> element of the given kind exists, then sets one attr. */
function upsertHeadTag(
  selector: string,
  create: () => HTMLElement,
  attr: string,
  value: string,
) {
  let el = document.head.querySelector<HTMLElement>(selector);
  if (!el) {
    el = create();
    document.head.appendChild(el);
  }
  el.setAttribute(attr, value);
}

/**
 * Keeps the app's canonical URL in sync with the site URL configured during
 * install (settings `site.url`, exposed via /api/site/config) and the current
 * route. Renders nothing. Mounted once inside the router so it sees route changes.
 *
 * Canonical uses the clean pathname only (no query string) — the convention for
 * canonical URLs. og:url mirrors it for social/link unfurling.
 */
export function CanonicalManager() {
  const { pathname } = useLocation();
  const { data } = useSiteConfig();
  const base = (data?.siteUrl ?? "").replace(/\/+$/, "");

  useEffect(() => {
    if (!base) return; // site URL not configured yet — leave head untouched
    let href: string;
    try {
      href = new URL(pathname, base + "/").toString();
    } catch {
      return; // malformed site URL — don't write a broken canonical
    }
    upsertHeadTag('link[rel="canonical"]', () => {
      const l = document.createElement("link");
      l.setAttribute("rel", "canonical");
      return l;
    }, "href", href);
    upsertHeadTag('meta[property="og:url"]', () => {
      const m = document.createElement("meta");
      m.setAttribute("property", "og:url");
      return m;
    }, "content", href);
  }, [base, pathname]);

  return null;
}

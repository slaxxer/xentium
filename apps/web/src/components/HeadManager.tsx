import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { HeadTags } from "@xentium/contracts";
import { api } from "../lib/api";

/**
 * The page's <head> for search engines and link previews, kept current as the
 * visitor navigates: title, description, robots, canonical, Open Graph / Twitter
 * tags and JSON-LD. The server writes the same tags into the first page it sends
 * (`seo.service` behind both), so a crawler that runs our JavaScript and one that
 * doesn't read the same thing. Without the SEO plugin these are core's defaults.
 *
 * Renders nothing. Mounted once inside the router. Not on ACP pages.
 */
const OWNED = [
  'meta[name="description"]', 'meta[name="robots"]', 'link[rel="canonical"]',
  'meta[property^="og:"]', 'meta[name^="twitter:"]', 'script[type="application/ld+json"]',
].join(",");

function apply(tags: HeadTags) {
  const head = document.head;
  head.querySelectorAll(OWNED).forEach((el) => el.remove());
  document.title = tags.title;
  const add = (el: HTMLElement) => head.appendChild(el);
  const meta = (attr: "name" | "property", key: string, content: string) => {
    const m = document.createElement("meta");
    m.setAttribute(attr, key);
    m.setAttribute("content", content);
    add(m);
  };
  if (tags.description) meta("name", "description", tags.description);
  if (tags.robots) meta("name", "robots", tags.robots);
  if (tags.canonical) {
    const l = document.createElement("link");
    l.rel = "canonical";
    l.href = tags.canonical;
    add(l);
  }
  for (const m of tags.meta) meta(m.property ? "property" : "name", (m.property ?? m.name)!, m.content);
  for (const ld of tags.jsonLd ?? []) {
    const s = document.createElement("script");
    s.type = "application/ld+json";
    s.textContent = JSON.stringify(ld);
    add(s);
  }
}

export function HeadManager() {
  const { pathname } = useLocation();
  const skip = pathname === "/admin" || pathname.startsWith("/admin/") || pathname.startsWith("/__");
  const { data } = useQuery<HeadTags>({
    queryKey: ["site-head", pathname],
    queryFn: () => api.get(`/site/head?path=${encodeURIComponent(pathname)}`),
    enabled: !skip,
    staleTime: 60_000,
    retry: false,
  });
  useEffect(() => {
    if (data && !skip) apply(data);
  }, [data, skip]);
  return null;
}

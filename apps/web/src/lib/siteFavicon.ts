// The site's favicon.
//
// index.html ships the Xentium icon as static files, in the BRAND colours. The logo
// in the header is the same mark drawn inline, coloured by the site's Logo icon
// tokens (`--logo-icon-from` / `--logo-icon-to`) — so once an admin recolours it, a
// static favicon no longer matches. Without an uploaded icon we therefore draw the
// favicon from the same tokens, as an SVG data URL; with one, the upload wins.

/** The brand colours the static files are drawn in (contracts' defaults). */
const BRAND = { from: "#f26b1d", to: "#e0336b" };

/** Fired by `applyTokenCss` whenever the token stylesheet changes. */
export const TOKENS_APPLIED_EVENT = "xt:tokens-applied";

/**
 * The mark at favicon size, exactly as `public/brand/favicon.svg` draws it (the
 * small geometry of `XentiumMark`: radius 25, glyph 68%).
 */
export function markFaviconSvg(from: string, to: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
    + `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>`
    + `</linearGradient></defs>`
    + `<rect width="100" height="100" rx="25" fill="url(#g)"/>`
    + `<g transform="translate(16 16) scale(1.4167)">`
    + `<g fill="none" stroke="#ffffff" stroke-width="9" stroke-linecap="round">`
    + `<path d="M8 8 L40 40"/><path d="M40 8 L32.5 15.5 M15.5 32.5 L8 40"/>`
    + `</g></g></svg>`;
}

/**
 * The Logo icon colours the page is painting with, or `null` when they are the
 * brand's own (the static files already match). Read off `:root`, where buildCSS
 * emits them; the computed value has any `var()` already substituted.
 *
 * ⚠ A value is dropped unless it is a plain colour — it goes into markup, and a
 * token is admin input.
 */
export function logoIconColours(): { from: string; to: string } | null {
  const root = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => {
    const v = root.getPropertyValue(name).trim();
    return v && /^[#\w\s(),.%/-]+$/.test(v) ? v : fallback;
  };
  const from = read("--logo-icon-from", BRAND.from);
  const to   = read("--logo-icon-to", BRAND.to);
  if (from.toLowerCase() === BRAND.from && to.toLowerCase() === BRAND.to) return null;
  return { from, to };
}

/**
 * Point EVERY icon link at `href` — a browser prefers the SVG link over the .ico, so
 * changing only one would leave the other showing. `null` restores what index.html
 * shipped (each link remembers its original on first change).
 */
export function setFavicon(href: string | null): void {
  const links = [...document.querySelectorAll<HTMLLinkElement>("link[rel~='icon']")];
  if (links.length === 0 && href) {
    const link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
    links.push(link);
  }
  for (const link of links) {
    if (link.dataset.origHref === undefined) {
      link.dataset.origHref  = link.getAttribute("href") ?? "";
      link.dataset.origType  = link.getAttribute("type") ?? "";
      link.dataset.origSizes = link.getAttribute("sizes") ?? "";
    }
    if (href) {
      link.removeAttribute("type");
      link.removeAttribute("sizes");
      link.href = href;
      continue;
    }
    link.setAttribute("href", link.dataset.origHref);
    if (link.dataset.origType)  link.type = link.dataset.origType;
    if (link.dataset.origSizes) link.setAttribute("sizes", link.dataset.origSizes);
  }
}

/** The favicon for the current page: the upload, else the mark in the site's colours. */
export function syncFavicon(uploadedUrl: string | null | undefined): void {
  if (uploadedUrl) { setFavicon(uploadedUrl); return; }
  const colours = logoIconColours();
  setFavicon(colours
    ? `data:image/svg+xml,${encodeURIComponent(markFaviconSvg(colours.from, colours.to))}`
    : null);
}

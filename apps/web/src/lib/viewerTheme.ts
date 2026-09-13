/**
 * The theme THIS VISITOR chose, if any.
 *
 * A site has one active theme — the admin's — and a visitor may choose to read it
 * wearing a different installed one instead. The choice is theirs alone: it changes
 * nothing on the server and nobody else sees it.
 *
 * ⚠ A COOKIE, not `localStorage`. It has to be readable before the first paint, by
 * both the layout fetch and the stylesheet fetch, and it has to work the same for a
 * guest as for a member — a preference that lived on the account would leave guests,
 * who are most of a public community's readers, without one. `SameSite=Lax` because
 * nothing here is sensitive and a link from elsewhere should still land on the theme
 * the reader picked.
 *
 * The value is only ever used as a QUERY PARAM the API validates against installed
 * themes: an id naming nothing falls back to the site's own, so a tampered cookie is
 * worth nothing.
 */
const COOKIE = "xt_theme";
const MAX_AGE_DAYS = 365;

/** Ids are slugs. Anything else is not a theme we installed, so it is not a choice. */
const VALID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export function viewerThemeId(): string | null {
  if (typeof document === "undefined") return null;
  const hit = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${COOKIE}=`));
  if (!hit) return null;
  const raw = decodeURIComponent(hit.slice(COOKIE.length + 1));
  return VALID.test(raw) ? raw : null;
}

/** Choose a theme, or pass null to go back to the site's own. */
export function setViewerTheme(id: string | null): void {
  if (typeof document === "undefined") return;
  const base = `${COOKIE}=`;
  document.cookie = id
    ? `${base}${encodeURIComponent(id)}; path=/; max-age=${MAX_AGE_DAYS * 86400}; SameSite=Lax`
    : `${base}; path=/; max-age=0; SameSite=Lax`;
}

/**
 * `?theme=<id>` for the two public fetches that depend on it, or "" for the site's own.
 *
 * ⚠ Both the stylesheet and the layouts have to be asked with the SAME answer, or a
 * visitor gets one theme's colours over another's arrangement. One helper is what
 * keeps them from drifting apart.
 */
export function viewerThemeParam(): string {
  const id = viewerThemeId();
  return id ? `theme=${encodeURIComponent(id)}` : "";
}

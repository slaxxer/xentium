/**
 * Beta gate — the public-route allowance.
 *
 * `beta.enabled` puts the whole SPA behind a code wall. Some pages have to stay
 * reachable anyway: a launch/landing page exists to be seen by exactly the
 * people the gate turns away. This is that list.
 *
 * The rules live here rather than in either app because the API decides what may
 * be STORED and the browser decides what RENDERS, and those two answers drifting
 * apart is how a gate springs a leak. One module, imported by both.
 */

/**
 * Prefixes the allowance may never name, whatever an admin types.
 *
 * `/` is on the list: allowing root would render the real home page to every
 * visitor and there would be no gate left. A landing page therefore lives at its
 * own path, and pointing `/` at it is a separate decision core has not made yet.
 */
export const BETA_RESERVED_ROUTES: readonly string[] = [
  "/",
  "/admin",
  "/acp",
  "/install",
  "/installer",
  "/login",
  "/logout",
  "/register",
  "/account",
  "/reset-password",
  "/verify-email",
];

/** Ceiling on stored entries — an allowance long enough to hide a mistake in is a mistake. */
export const BETA_MAX_PUBLIC_ROUTES = 20;

export interface BetaRouteRejection {
  value:  string;
  reason: "not-a-path" | "off-origin" | "reserved" | "too-many";
}

export interface BetaRouteNormalizeResult {
  routes:   string[];
  rejected: BetaRouteRejection[];
}

/** `/Foo/Bar/` → `/foo/bar`. Query and hash are dropped, not encoded. */
function canonical(raw: string): string {
  let p = raw.trim().split(/[?#]/)[0] ?? "";
  p = p.replace(/\/+$/, "");
  return p.toLowerCase();
}

/**
 * Validate and canonicalise a stored allowance.
 *
 * Total: anything it cannot vouch for is rejected rather than repaired, and the
 * caller is told which entries went and why. Run on WRITE for the error message
 * and on READ for the guarantee — a value can reach the settings table through
 * the generic `PUT /admin/settings/:key` without passing through here first.
 */
export function normalizeBetaPublicRoutes(input: unknown): BetaRouteNormalizeResult {
  const list     = Array.isArray(input) ? input : [];
  const routes:   string[]             = [];
  const rejected: BetaRouteRejection[] = [];

  for (const entry of list) {
    if (typeof entry !== "string") {
      rejected.push({ value: String(entry), reason: "not-a-path" });
      continue;
    }
    const value = entry.trim();

    // `//host` is protocol-relative and `scheme://` is absolute; both leave the
    // origin, and neither is a route this app can gate.
    if (value.includes("://") || value.startsWith("//")) {
      rejected.push({ value, reason: "off-origin" });
      continue;
    }
    if (!value.startsWith("/")) {
      rejected.push({ value, reason: "not-a-path" });
      continue;
    }

    const path = canonical(value);
    // `canonical` empties a bare "/" — which is reserved anyway.
    if (path === "" || BETA_RESERVED_ROUTES.some((r) => path === r || path.startsWith(`${r}/`))) {
      rejected.push({ value, reason: "reserved" });
      continue;
    }
    // `..` cannot climb out of a client-side route, but it can disguise one.
    if (path.split("/").includes("..")) {
      rejected.push({ value, reason: "not-a-path" });
      continue;
    }
    if (routes.includes(path)) continue;
    if (routes.length >= BETA_MAX_PUBLIC_ROUTES) {
      rejected.push({ value, reason: "too-many" });
      continue;
    }
    routes.push(path);
  }

  return { routes, rejected };
}

/**
 * Does `pathname` fall inside the allowance?
 *
 * Prefix match on a SEGMENT boundary: `/launch` covers `/launch/thanks` but
 * never `/launchpad`. Naive `startsWith` would hand out the second.
 */
export function isBetaPublicRoute(pathname: string, allowed: readonly string[]): boolean {
  const path = canonical(pathname) || "/";
  return allowed.some((entry) => {
    const a = canonical(entry);
    return a !== "" && (path === a || path.startsWith(`${a}/`));
  });
}

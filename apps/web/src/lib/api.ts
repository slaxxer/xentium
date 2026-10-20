import { authStore, type AuthUser } from "./authStore";
import { applyServerLocale, uiLocale } from "./i18n";
import { fatalErrorStore } from "./fatalError";

// The /auth/me endpoint returns groups as the UserGroup join table:
// [{ group: { id, name, key } }]. Flatten to [{ id, name, key }].
export function normalizeUser(raw: Record<string, unknown>): AuthUser {
  type RawGroup = {
    group?: {
      id: string; name: string; key: string; icon?: string | null;
      progression?: { badgeColor?: string | null; badgeLabel?: string | null } | null;
    };
    id?: string; name?: string; key?: string;
    icon?: string | null;
    badgeColor?: string | null;
    badgeLabel?: string | null;
  };
  const groups = (raw.groups as RawGroup[] | undefined) ?? [];
  const hiddenBadges = (raw.hiddenBadges as string[] | undefined) ?? [];
  const mapped = groups.map((g) => {
    const grp = g.group ?? g;
    return {
      id:           grp.id ?? "",
      name:         grp.name ?? "",
      key:          grp.key ?? "",
      icon:         grp.icon ?? null,
      displayOrder: (grp as any).displayOrder ?? 100,
      badgeColor:   g.group?.progression?.badgeColor ?? (g as any).badgeColor ?? null,
      badgeLabel:   g.group?.progression?.badgeLabel ?? (g as any).badgeLabel ?? null,
    };
  });
  return {
    ...(raw as unknown as AuthUser),
    groups: mapped,                                              // full membership (role gating)
    hiddenBadges,
    visibleGroups: mapped.filter((g) => !hiddenBadges.includes(g.id)), // self-badge display
  };
}

const BASE = "/api";

let _refreshing: Promise<string | null> | null = null;

async function tryRefresh(): Promise<string | null> {
  if (_refreshing) return _refreshing;
  _refreshing = (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        authStore.clear(); // also marks loaded=true
        return null;
      }
      const { accessToken } = await res.json();
      const meRes = await fetch(`${BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        credentials: "include",
      });
      if (meRes.ok) {
        const { user } = await meRes.json();
        authStore.set(accessToken, normalizeUser(user)); // also marks loaded=true
        applyServerLocale(user?.preferredLocale);
      } else {
        authStore.markLoaded();
      }
      return accessToken;
    } catch {
      authStore.clear();
      return null;
    } finally {
      _refreshing = null;
    }
  })();
  return _refreshing;
}

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const headers: Record<string, string> = {};
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  if (body !== undefined && !isFormData) headers["Content-Type"] = "application/json";
  if (authStore.token) headers["Authorization"] = `Bearer ${authStore.token}`;
  // The language this page is in. The API stays locale-agnostic; it only reads this
  // to write an email to someone it has no account language for (a registration code).
  headers["X-Xentium-Locale"] = uiLocale();

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: "include",
    body: body === undefined ? undefined : isFormData ? (body as FormData) : JSON.stringify(body),
  });

  if (res.status === 401 && retry && authStore.token) {
    const newToken = await tryRefresh();
    if (newToken) return request(method, path, body, false);
  }

  if (!res.ok) {
    // Read the body ONCE. `json()` then `text()` threw "body stream already read" on
    // any non-JSON error (a proxy's HTML 502 while the API restarts), and that browser
    // message reached the toast instead of the real failure.
    const raw = await res.text().catch(() => "");
    let detail: unknown;
    try { detail = raw ? JSON.parse(raw) : null; } catch { detail = raw; }
    // Canonical shape: { error: { code, message, details, severity } }. The only
    // flat-string `error` left is the pre-install installer/setup surface.
    const errObj = (detail as any)?.error;
    const err = new Error(errObj?.message ?? (typeof errObj === "string" ? errObj : `http_${res.status}`));
    (err as any).status = res.status;
    (err as any).detail = detail;

    // Server-class failure → trip the global fatal-halt overlay (WoltLab style).
    // 4xx (validation, not-found, forbidden, rate-limit) intentionally do NOT halt;
    // they keep surfacing as inline toasts via the normal throw path.
    // Maintenance mode also returns 503 but is an intentional state — let the
    // MaintenanceGate render its own screen instead of the fatal overlay.
    // Signed in with a legal document still to accept (asked again while the page was
    // open): note what is pending, so LegalConsentGate sends the member to it now.
    if (errObj?.code === "XEC-AUTH-2012" && authStore.token && authStore.user && Array.isArray(errObj.details?.pending)) {
      authStore.set(authStore.token, { ...authStore.user, pendingLegal: errObj.details.pending, needsLegalConsent: true });
    }
    const isMaintenance = errObj?.code === "XEC-CORE-8010" || (detail as any)?.maintenance === true;
    if (res.status >= 500 && !isMaintenance) {
      fatalErrorStore.trigger({
        code:     errObj?.code ?? `XEC-API-${res.status}`,
        message:  errObj?.message ?? "An unexpected server error occurred.",
        severity: errObj?.severity ?? "critical",
        status:   res.status,
      });
    }
    throw err;
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/**
 * POST that returns the raw Response for reading a streamed body (e.g. ndjson
 * progress). Attaches the Bearer token and retries once on a 401 after refresh.
 * The caller owns res.body/res.ok — this does not parse or throw on !ok.
 */
export async function apiStream(path: string, body: unknown): Promise<Response> {
  // FormData carries its own multipart Content-Type, including the boundary the
  // server splits on. Setting the header ourselves would overwrite it with one
  // that has no boundary, and every field would arrive unparsed.
  const isForm = body instanceof FormData;
  const build = (token: string | null): RequestInit => ({
    method: "POST",
    headers: {
      ...(isForm ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: "include",
    body: isForm ? body : JSON.stringify(body),
  });
  let res = await fetch(`${BASE}${path}`, build(authStore.token));
  if (res.status === 401 && authStore.token) {
    const newToken = await tryRefresh();
    if (newToken) res = await fetch(`${BASE}${path}`, build(newToken));
  }
  return res;
}

/**
 * GET a file the API sends as an attachment (a CSV export, say) and hand it to the
 * browser as a download. Same auth and 401 retry as every other call; the server's
 * Content-Disposition names the file unless `fallbackName` has to.
 */
export async function apiDownload(path: string, fallbackName: string): Promise<void> {
  const build = (token: string | null): RequestInit => ({
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: "include",
  });
  let res = await fetch(`${BASE}${path}`, build(authStore.token));
  if (res.status === 401 && authStore.token) {
    const newToken = await tryRefresh();
    if (newToken) res = await fetch(`${BASE}${path}`, build(newToken));
  }
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const api = {
  get:    <T>(path: string)                 => request<T>("GET",    path),
  post:   <T>(path: string, body?: unknown) => request<T>("POST",   path, body),
  put:    <T>(path: string, body?: unknown) => request<T>("PUT",    path, body),
  patch:  <T>(path: string, body?: unknown) => request<T>("PATCH",  path, body),
  delete: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),
  tryRefresh,
};

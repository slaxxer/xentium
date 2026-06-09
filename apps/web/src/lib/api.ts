import { authStore, type AuthUser } from "./authStore";
import { applyServerLocale } from "./i18n";

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
  return {
    ...(raw as unknown as AuthUser),
    groups: groups.map((g) => {
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
    }),
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
    let detail: unknown;
    try { detail = await res.json(); } catch { detail = await res.text(); }
    const err = new Error((detail as any)?.error ?? `http_${res.status}`);
    (err as any).status = res.status;
    (err as any).detail = detail;
    throw err;
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get:    <T>(path: string)                 => request<T>("GET",    path),
  post:   <T>(path: string, body?: unknown) => request<T>("POST",   path, body),
  put:    <T>(path: string, body?: unknown) => request<T>("PUT",    path, body),
  patch:  <T>(path: string, body?: unknown) => request<T>("PATCH",  path, body),
  delete: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),
  tryRefresh,
};

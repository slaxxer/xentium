import { useSyncExternalStore } from "react";
import { authStore } from "../lib/authStore";
import { api, normalizeUser } from "../lib/api";
import { applyServerLocale } from "../lib/i18n";

// Bootstrap auth immediately when this module is imported — before any component
// renders. This way the first render that reads auth state gets the correct value
// rather than flashing the unauthenticated state while the refresh is in-flight.
api.tryRefresh();

export function useAuth() {
  const { token, user, loaded } = useSyncExternalStore(
    authStore.subscribe,
    authStore.getSnapshot,
  );

  return {
    user,
    isAuthenticated: !!token,
    isLoading: !loaded,
  };
}

/** Call after a successful /auth/login response to populate auth state. */
export async function applyLogin(accessToken: string) {
  const res = await fetch("/api/auth/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
    credentials: "include",
  });
  if (res.ok) {
    const { user } = await res.json();
    authStore.set(accessToken, normalizeUser(user));
    applyServerLocale(user?.preferredLocale);
  }
}

export function applyLogout() {
  authStore.clear();
}

/** Re-fetch /auth/me with the current token and refresh the store (e.g. after
    changing badge visibility so the MeCard / nav update immediately). */
export async function refreshCurrentUser() {
  const token = authStore.token;
  if (!token) return;
  const res = await fetch("/api/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
    credentials: "include",
  });
  if (res.ok) {
    const { user } = await res.json();
    authStore.set(token, normalizeUser(user));
  }
}

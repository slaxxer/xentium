import type {
  InstallStatusDto,
  EnvironmentCheckDto,
  SetupConfigInput,
  SetupProbeResult,
  SiteConfigInput,
  AdminAccountInput,
  InstallAddonsDto,
  InstallAddonInstallResult,
} from "@xentium/contracts";

/**
 * The installer talks to the API directly instead of through `lib/api.ts`.
 *
 * Two reasons, both about this being the PRE-install surface:
 *
 * 1. `lib/api.ts` trips the global fatal-error overlay on any 5xx. Half the
 *    things that go wrong in here — an unreachable marketplace, a database that
 *    is not up yet — are exactly what the wizard is there to tell you about, and
 *    a full-screen crash overlay is the wrong way to say it.
 * 2. It attaches `authStore.token`, which is empty during an install. The one
 *    authenticated call (installing an add-on) presents the token the ADMIN step
 *    handed back, and that token is held by the wizard, not the auth store —
 *    `/auth/me` is blocked until the install completes, so there is no user to
 *    put in the store.
 */
const BASE = "/api";

/** The access token the ADMIN step returns, for the one route that needs one. */
let installToken: string | null = null;
export function setInstallToken(token: string | null): void {
  installToken = token;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (installToken) headers["Authorization"] = `Bearer ${installToken}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: "include",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!res.ok) {
    let detail: unknown;
    try { detail = await res.json(); } catch { detail = null; }
    // The installer answers with a flat `{ error: "message" }`; a canonical NEC
    // envelope can still arrive from shared middleware (the rate limiter).
    const raw = (detail as { error?: unknown } | null)?.error;
    const message =
      typeof raw === "string" ? raw
      : typeof (raw as { message?: string } | undefined)?.message === "string" ? (raw as { message: string }).message
      : `http_${res.status}`;
    const err = new Error(message);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface LinkStart {
  linkId: string;
  userCode: string;
  approveUrl: string;
  expiresAt: string;
  pollInterval: number;
}

export type LinkStatus =
  | { status: "pending" | "denied" | "expired" }
  | { status: "approved"; accountRef: string; connectedAt: string };

export const installerApi = {
  status: () => call<InstallStatusDto>("GET", "/install/status"),
  environment: () => call<EnvironmentCheckDto>("GET", "/install/environment"),

  /** Setup mode only: verify credentials without writing anything. */
  probe: (body: SetupConfigInput) => call<SetupProbeResult>("POST", "/install/database/probe", body),
  /** Setup mode only: post DB credentials; the server writes .env and hot-swaps. */
  setup: (body: SetupConfigInput) => call<{ ok: boolean }>("POST", "/install/setup", body),

  testDatabase: () => call<{ ok: boolean }>("GET", "/install/database/test"),
  database: (databaseUrl?: string) => call("POST", "/install/database", { databaseUrl }),
  site: (body: SiteConfigInput) => call("POST", "/install/site", body),

  addons: () => call<InstallAddonsDto>("GET", "/install/addons"),
  selectAddons: (pluginIds: string[]) => call("POST", "/install/addons", { pluginIds }),
  installAddon: (pluginId: string, version: string) =>
    call<InstallAddonInstallResult>("POST", "/install/addons/install", { pluginId, version }),

  startLink: () => call<LinkStart>("POST", "/install/marketplace/link", {}),
  pollLink: (linkId: string) => call<LinkStatus>("GET", `/install/marketplace/link/${linkId}`),
  unlink: () => call<{ ok: boolean }>("DELETE", "/install/marketplace/connection"),

  admin: (body: AdminAccountInput) =>
    call<{ currentStep: string; accessToken: string }>("POST", "/install/admin", body),
  finalize: () => call<{ siteId?: string }>("POST", "/install/finalize", {}),
};

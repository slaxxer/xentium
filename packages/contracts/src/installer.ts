import { z } from "zod";
import type { MarketplaceListing } from "./marketplace.js";

export const InstallStep = {
  WELCOME: "WELCOME",
  ENVIRONMENT: "ENVIRONMENT",
  DATABASE: "DATABASE",
  SITE_CONFIG: "SITE_CONFIG",
  ADDONS: "ADDONS",
  ADMIN: "ADMIN",
  FINALIZE: "FINALIZE",
  COMPLETE: "COMPLETE",
} as const;
export type InstallStep = (typeof InstallStep)[keyof typeof InstallStep];

export const INSTALL_STEP_ORDER: InstallStep[] = [
  InstallStep.WELCOME,
  InstallStep.ENVIRONMENT,
  InstallStep.DATABASE,
  InstallStep.SITE_CONFIG,
  InstallStep.ADDONS,
  InstallStep.ADMIN,
  InstallStep.FINALIZE,
  InstallStep.COMPLETE,
];

export interface InstallStatusDto {
  installed: boolean;
  currentStep: InstallStep;
  siteId: string | null;
  /** True while the API runs the pre-env setup server (no usable .env yet).
   *  The wizard's DATABASE step shows a credentials form instead of the
   *  test-connection button. False/absent once the full app is booted. */
  setupMode?: boolean;
  /** The platform version, so the wizard can print what it is installing. The
   *  setup server answers it too — it is the one thing both modes know. */
  version?: string;
}

export interface EnvironmentCheckDto {
  ok: boolean;
  checks: Array<{
    key: string; name: string; ok: boolean; detail: string;
    /** Passes, but isn't what we recommend (e.g. Postgres 14, a Redis eviction
     *  policy that can drop queued jobs). Never blocks the install. */
    warn?: boolean;
  }>;
}

export interface DatabaseConfigInput {
  databaseUrl?: string;
}

/** Setup-mode only (§16 step 3/4): DB credentials collected by the wizard,
 *  turned into DATABASE_URL + generated secrets and written to .env. */
export const setupConfigSchema = z.object({
  host: z.string().min(1).default("localhost"),
  port: z.coerce.number().int().positive().max(65535).default(5432),
  database: z.string().min(1),
  user: z.string().min(1),
  password: z.string().default(""),
  redisUrl: z.string().min(1).optional(),
});

export interface SetupConfigInput {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  redisUrl?: string;
}

export const siteConfigSchema = z.object({
  siteName: z.string().min(1).max(120),
  siteUrl: z.string().url(),
  locale: z.string().min(2).max(10).default("en"),
  timezone: z.string().default("UTC")
});

export interface SiteConfigInput {
  siteName: string;
  siteUrl: string;
  locale: string;
  timezone: string;
}

export const adminAccountSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(5).max(200),
});

export interface AdminAccountInput {
  email: string;
  username: string;
  password: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ADD-ONS step (§16 / ADR-0001)
//
// The wizard's fifth step browses the marketplace catalogue, links an account
// and records which plugins to install. Nothing is downloaded here: the choice
// is a SELECTION, and the artifacts are fetched during the install run — after
// the administrator exists, because the install path is the same authenticated
// one the ACP uses and it attributes the install to a user.
// ─────────────────────────────────────────────────────────────────────────────

/** What the ADD-ONS step needs to draw itself, in one call. */
export interface InstallAddonsDto {
  /** False when the marketplace could not be reached. The step still renders —
   *  it just says so instead of showing an empty catalogue as "nothing to add". */
  reachable: boolean;
  connected: boolean;
  /** Display label for the linked account (masked email / account id), never a token. */
  accountRef: string | null;
  listings: MarketplaceListing[];
  /** Ids the account holds a licence for. Separate from `listings[].owned` so a
   *  catalogue page that predates the field still answers the lock correctly. */
  ownedIds: string[];
  /** The selection already recorded on this install, so a back-and-forward
   *  through the wizard does not silently drop it. */
  selected: string[];
}

export const installAddonSelectionSchema = z.object({
  pluginIds: z.array(z.string().min(1).max(200)).max(50).default([]),
});

export interface InstallAddonSelectionInput {
  pluginIds: string[];
}

export const installAddonInstallSchema = z.object({
  pluginId: z.string().min(1).max(200),
  version: z.string().min(1).max(64),
});

export interface InstallAddonInstallInput {
  pluginId: string;
  version: string;
}

export interface InstallAddonInstallResult {
  id: string;
  name: string;
  version: string;
  /** Add-ons picked in the wizard are enabled straight away — an admin who ticked
   *  "Forum" expects a forum, not a disabled package. False when enabling failed
   *  (a licence the marketplace declined at the gate); the package is installed
   *  either way and the ACP can enable it later. */
  enabled: boolean;
}

/** Setup-mode only: verify credentials WITHOUT writing anything. The DATABASE
 *  step probes as you type; only Continue writes `.env`. */
export interface SetupProbeResult {
  ok: boolean;
  /** Server version string when we got far enough to ask, else null. */
  postgres: string | null;
  /** null when no Redis URL was supplied — absence is not a failure. */
  redis: string | null;
  /** Round-trip of the connect + SELECT 1, in milliseconds. */
  latencyMs: number;
}

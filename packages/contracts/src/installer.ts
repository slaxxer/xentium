import { z } from "zod";

export const InstallStep = {
  WELCOME: "WELCOME",
  ENVIRONMENT: "ENVIRONMENT",
  DATABASE: "DATABASE",
  SITE_CONFIG: "SITE_CONFIG",
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
}

export interface EnvironmentCheckDto {
  ok: boolean;
  checks: Array<{ key: string; name: string; ok: boolean; detail: string }>;
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

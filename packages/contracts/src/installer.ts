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
}

export interface EnvironmentCheckDto {
  ok: boolean;
  checks: Array<{ key: string; name: string; ok: boolean; detail: string }>;
}

export interface DatabaseConfigInput {
  databaseUrl?: string;
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

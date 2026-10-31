import type { TFunction } from "i18next";
import { siteTime } from "../../../lib/datetime";

/**
 * One place that turns an API error into what the member reads. Codes the
 * doorway knows get our wording; a plugin guard's refusal (beta, lockout)
 * brings its own message, which is shown as is.
 */
export interface ApiErr { code?: string; message?: string; details?: Record<string, unknown> }

export function apiErr(err: unknown): ApiErr {
  const e = (err as { detail?: { error?: ApiErr } } | null)?.detail?.error;
  return e ?? { message: (err as Error | null)?.message };
}

const KNOWN: Record<string, string> = {
  "XEC-AUTH-1001": "door.err.invalid",
  "XEC-AUTH-1011": "door.err.linkInvalid",
  "XEC-AUTH-1050": "door.err.passkeyFailed",
  "XEC-AUTH-1051": "door.err.passkeyUnavailable",
  "XEC-AUTH-1060": "door.err.providerFailed",
  "XEC-AUTH-1061": "door.err.providerEmailTaken",
  "XEC-AUTH-1062": "door.err.providerUnavailable",
  "XEC-AUTH-1063": "door.err.lastMethod",
  "XEC-AUTH-1020": "door.err.inviteRequired",
  "XEC-AUTH-1021": "door.err.inviteInvalid",
  "XEC-AUTH-2001": "door.err.emailTaken",
  "XEC-AUTH-2002": "door.err.usernameTaken",
  "XEC-AUTH-2003": "door.err.codeWrong",
  "XEC-AUTH-2010": "door.err.closed",
};

/** Codes whose server message is the point (a guard's own wording, a lockout's retry window). */
const SERVER_WORDED = new Set(["XEC-AUTH-1030", "XEC-AUTH-1031", "XEC-AUTH-1032", "XEC-AUTH-1040"]);

/** Inside the authenticator-code step. */
export function totpErrorText(t: TFunction, e: ApiErr): string {
  switch (e.code) {
    case "XEC-AUTH-1070": return t("door.err.totpWrong");
    case "XEC-AUTH-1071": return t("door.err.totpUsed");
    case "XEC-AUTH-1072": return t("door.err.totpLocked");
    case "XEC-AUTH-1073": return t("door.err.totpExpired");
    default: return errorText(t, e, "door.err.totpWrong");
  }
}

/** Inside a PIN step, "invalid credentials" can only mean the PIN. */
export function pinErrorText(t: TFunction, e: ApiErr): string {
  return e.code === "XEC-AUTH-1001" ? t("door.err.pinWrong") : errorText(t, e, "door.err.pinWrong");
}

export function errorText(t: TFunction, e: ApiErr, fallback = "door.err.generic"): string {
  if (e.code === "XEC-AUTH-1003" || e.code === "XEC-AUTH-1004") {
    const reason = (e.details?.reason as string | undefined) ?? "";
    const until = e.details?.expiresAt as string | null | undefined;
    return until
      ? t("door.err.bannedUntil", { date: siteTime.date(until), reason })
      : t("door.err.bannedForever", { reason });
  }
  if (e.code && SERVER_WORDED.has(e.code) && e.message) return e.message;
  if (e.code && KNOWN[e.code]) return t(KNOWN[e.code]!);
  return t(fallback);
}

/** The same, for a bare code arriving in the URL after a provider redirect. */
export const codeText = (t: TFunction, code: string) => errorText(t, { code });

import { browserSupportsWebAuthn, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { api } from "../../../lib/api";

/**
 * The browser half of the sign-in methods. Every method answers with the same
 * shape: a session (`accessToken`), a PIN step or an authenticator-code step. A
 * password PIN step has no ticket (the password is re-sent with the PIN); every
 * other step's does.
 */
export interface SignInResponse {
  accessToken?: string;
  requiresPin?: boolean;
  requiresTotp?: boolean;
  ticket?: string;
}

export interface AuthMethods {
  passkeys: boolean;
  magicLink: boolean;
  providers: Array<"google" | "github" | "discord">;
}

export const passkeysSupported = () => {
  try { return browserSupportsWebAuthn(); } catch { return false; }
};

export async function signInWithPasskey(remember: boolean): Promise<SignInResponse> {
  const { ceremonyId, options } = await api.post<{ ceremonyId: string; options: PublicKeyCredentialRequestOptionsJSON }>(
    "/auth/passkey/login/options", {});
  const response = await startAuthentication({ optionsJSON: options });
  return api.post<SignInResponse>("/auth/passkey/login/verify", { ceremonyId, response, remember });
}

export async function addPasskey(name: string) {
  const options = await api.post<PublicKeyCredentialCreationOptionsJSON>("/auth/passkey/register/options", {});
  const response = await startRegistration({ optionsJSON: options });
  return api.post<{ id: string; name: string }>("/auth/passkey/register/verify", { response, name });
}

/** Leave for the provider. The server has set the state cookie on this response. */
export async function startProvider(provider: string, remember: boolean, returnTo: string): Promise<void> {
  const { url } = await api.post<{ url: string }>(`/auth/oauth/${provider}/start`, { remember, returnTo });
  window.location.assign(url);
}

export async function completePin(ticket: string, pin: string): Promise<SignInResponse> {
  return api.post<SignInResponse>("/auth/login/pin", { ticket, pin });
}

export async function completeTotp(ticket: string, code: string): Promise<SignInResponse> {
  return api.post<SignInResponse>("/auth/login/2fa", { ticket, code });
}

/** A readable label for the device a passkey is being made on. */
export function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Mac OS X/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  if (/Linux/.test(ua)) return "Linux";
  return "Passkey";
}

/** A user who closed the passkey prompt did nothing wrong — say nothing. */
export const isPasskeyCancel = (err: unknown) =>
  err instanceof Error && (err.name === "NotAllowedError" || err.name === "AbortError");

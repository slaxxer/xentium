import crypto from "node:crypto";
import { prisma } from "../../infrastructure/db.js";
import { redis, rkey } from "../../infrastructure/redis.js";
import { env } from "../../config/env.js";
import { getSetting, bustSettingsCache } from "../../shared/utils/settings.js";
import { decryptSecret, encryptSecret } from "../../shared/utils/secretBox.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { XEC } from "../../shared/errors/xec.js";
import { authGuardRegistry } from "../../core/auth-guard-registry/auth-guard-registry.js";
import { finishSignIn, type SignInContext, type SignInResult } from "./auth.signin.js";
import { assertKeepsASignInMethod } from "./signInMethods.service.js";

/**
 * Sign in with Google, GitHub or Discord (OAuth 2 authorization code + PKCE).
 *
 * An admin registers an app with the provider and enters its client id and
 * secret in the ACP (the secret is encrypted at rest and never sent back).
 * Every flow starts with a one-time `state` kept server-side for ten minutes,
 * AND pinned to the browser that started it by a signed cookie — without that
 * second half, an attacker could send someone a callback URL carrying the
 * attacker's own code and sign them in to the attacker's account.
 *
 * Accounts are matched by the provider's stable id, never by email. A provider
 * address that already belongs to a member is NOT linked automatically: they
 * sign in the usual way and connect the provider from their account settings,
 * so owning an email at Google is never enough to take over an account here.
 */

export const OAUTH_PROVIDERS = ["google", "github", "discord"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];
export const isProvider = (p: string): p is OAuthProvider => (OAUTH_PROVIDERS as readonly string[]).includes(p);

interface ProviderSpec {
  authorize: string;
  token: string;
  scope: string;
  profile: (accessToken: string) => Promise<ProviderProfile>;
}

export interface ProviderProfile {
  id: string;
  email: string | null;
  emailVerified: boolean;
  /** A username-ish handle, when the provider has one. */
  handle: string | null;
  name: string | null;
}

async function getJson<T>(url: string, accessToken: string): Promise<T> {
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json", "user-agent": "Xentium" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`profile ${res.status}`);
  return (await res.json()) as T;
}

const SPECS: Record<OAuthProvider, ProviderSpec> = {
  google: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scope: "openid email profile",
    profile: async (t) => {
      const p = await getJson<{ sub: string; email?: string; email_verified?: boolean; name?: string }>(
        "https://openidconnect.googleapis.com/v1/userinfo", t);
      return { id: p.sub, email: p.email ?? null, emailVerified: !!p.email_verified, handle: p.email?.split("@")[0] ?? null, name: p.name ?? null };
    },
  },
  github: {
    authorize: "https://github.com/login/oauth/authorize",
    token: "https://github.com/login/oauth/access_token",
    scope: "read:user user:email",
    profile: async (t) => {
      const p = await getJson<{ id: number; login: string; name?: string | null }>("https://api.github.com/user", t);
      // The public profile email may be absent or unverified; the emails
      // endpoint says which address is primary AND verified.
      const emails = await getJson<Array<{ email: string; primary: boolean; verified: boolean }>>("https://api.github.com/user/emails", t)
        .catch(() => []);
      const primary = emails.find((e) => e.primary && e.verified) ?? null;
      return { id: String(p.id), email: primary?.email ?? null, emailVerified: !!primary, handle: p.login, name: p.name ?? null };
    },
  },
  discord: {
    authorize: "https://discord.com/oauth2/authorize",
    token: "https://discord.com/api/oauth2/token",
    scope: "identify email",
    profile: async (t) => {
      const p = await getJson<{ id: string; username: string; global_name?: string | null; email?: string | null; verified?: boolean }>(
        "https://discord.com/api/users/@me", t);
      return { id: p.id, email: p.email ?? null, emailVerified: !!p.verified, handle: p.username, name: p.global_name ?? null };
    },
  },
};

// ── Configuration (ACP) ──────────────────────────────────────────────────────

const settingKey = (p: OAuthProvider) => `auth.oauth.${p}`;
interface StoredConfig { enabled?: boolean; clientId?: string; clientSecret?: string }

async function storedConfig(p: OAuthProvider): Promise<StoredConfig> {
  return (await getSetting<StoredConfig>(settingKey(p), {})) ?? {};
}

/** The callback address the admin registers with the provider. */
export const callbackUrl = (p: OAuthProvider) => `${env.APP_URL.replace(/\/$/, "")}/api/auth/oauth/${p}/callback`;

/** What the ACP shows: never the secret, only whether one is set. */
export async function providerConfigView() {
  return Promise.all(OAUTH_PROVIDERS.map(async (p) => {
    const c = await storedConfig(p);
    return { provider: p, enabled: !!c.enabled, clientId: c.clientId ?? "", secretSet: !!c.clientSecret, callbackUrl: callbackUrl(p) };
  }));
}

/** Which providers the sign-in page may offer: enabled AND fully configured. */
export async function enabledProviders(): Promise<OAuthProvider[]> {
  const out: OAuthProvider[] = [];
  for (const p of OAUTH_PROVIDERS) {
    const c = await storedConfig(p);
    if (c.enabled && c.clientId && c.clientSecret) out.push(p);
  }
  return out;
}

/**
 * Change one provider's settings. `clientSecret: null` removes it; `undefined`
 * leaves it alone (the ACP never has the old one to send back).
 */
export async function updateProviderConfig(p: OAuthProvider, patch: { enabled?: boolean; clientId?: string; clientSecret?: string | null }) {
  const current = await storedConfig(p);
  const next: StoredConfig = { ...current };
  if (patch.enabled !== undefined) next.enabled = patch.enabled;
  if (patch.clientId !== undefined) next.clientId = patch.clientId.trim();
  if (patch.clientSecret === null) delete next.clientSecret;
  else if (patch.clientSecret !== undefined) next.clientSecret = encryptSecret(patch.clientSecret.trim());
  await prisma.setting.upsert({
    where: { key: settingKey(p) },
    update: { value: next as object },
    create: { key: settingKey(p), value: next as object },
  });
  bustSettingsCache(settingKey(p));
}

async function credentialsFor(p: OAuthProvider) {
  const c = await storedConfig(p);
  if (!c.enabled || !c.clientId || !c.clientSecret) {
    throw new XentiumError({ code: XEC.AUTH_OAUTH_UNAVAILABLE, httpStatus: 400, message: "This sign-in provider is not set up" });
  }
  return { clientId: c.clientId, clientSecret: decryptSecret(c.clientSecret) };
}

// ── The flow ─────────────────────────────────────────────────────────────────

export const OAUTH_STATE_COOKIE = "xt_oauth";
const STATE_TTL_SEC = 600;
const stateKey = (state: string) => rkey(`auth:oauth:state:${state}`);

interface PendingState {
  provider: OAuthProvider;
  intent: "signin" | "link";
  /** Set for "link": the member who asked to connect this provider. */
  userId?: string;
  persistent: boolean;
  returnTo: string;
  codeVerifier: string;
}

/** Only same-site paths: a returnTo is where we send the browser afterwards. */
export function safeReturnTo(raw: string | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/";
  return raw.slice(0, 500);
}

/** Build the provider URL. The caller sets the state cookie and sends the browser there. */
export async function startFlow(
  p: OAuthProvider, opts: { intent: "signin" | "link"; userId?: string; persistent: boolean; returnTo?: string },
): Promise<{ url: string; state: string }> {
  const { clientId } = await credentialsFor(p);
  const state = crypto.randomBytes(24).toString("base64url");
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  const pending: PendingState = {
    provider: p, intent: opts.intent, userId: opts.userId, persistent: opts.persistent,
    returnTo: safeReturnTo(opts.returnTo), codeVerifier,
  };
  await redis.set(stateKey(state), JSON.stringify(pending), "EX", STATE_TTL_SEC);

  const url = new URL(SPECS[p].authorize);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", callbackUrl(p));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SPECS[p].scope);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (p === "google") url.searchParams.set("prompt", "select_account");
  return { url: url.toString(), state };
}

async function exchangeCode(p: OAuthProvider, code: string, codeVerifier: string): Promise<string> {
  const { clientId, clientSecret } = await credentialsFor(p);
  const res = await fetch(SPECS[p].token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret, code, grant_type: "authorization_code",
      redirect_uri: callbackUrl(p), code_verifier: codeVerifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string };
  if (!res.ok || !body.access_token) throw new Error(`token ${res.status}`);
  return body.access_token;
}

export type CallbackOutcome =
  | { kind: "signin"; result: SignInResult; returnTo: string }
  | { kind: "linked"; provider: OAuthProvider; returnTo: string }
  | { kind: "error"; code: string; returnTo: string; intent: "signin" | "link" };

const oauthError = (code: string, returnTo: string, intent: "signin" | "link"): CallbackOutcome => ({ kind: "error", code, returnTo, intent });

/**
 * The provider sent the browser back. `cookieState` is the value of the state
 * cookie this browser carries: it must equal the `state` in the URL.
 */
export async function handleCallback(
  p: OAuthProvider, params: { code?: string; state?: string; error?: string }, cookieState: string | undefined,
  ctx: SignInContext, deps: { fetchProfile?: (p: OAuthProvider, token: string) => Promise<ProviderProfile>; exchange?: typeof exchangeCode } = {},
): Promise<CallbackOutcome> {
  if (!params.state) return oauthError(XEC.AUTH_OAUTH_FAILED, "/", "signin");
  const raw = await redis.getdel(stateKey(params.state));
  if (!raw) return oauthError(XEC.AUTH_OAUTH_FAILED, "/", "signin");
  const pending = JSON.parse(raw) as PendingState;
  const fail = (code: string = XEC.AUTH_OAUTH_FAILED) => oauthError(code, pending.returnTo, pending.intent);

  if (pending.provider !== p || !cookieState || cookieState !== params.state) return fail();
  if (params.error || !params.code) return fail();

  let profile: ProviderProfile;
  try {
    const token = await (deps.exchange ?? exchangeCode)(p, params.code, pending.codeVerifier);
    profile = await (deps.fetchProfile ?? ((prov, t) => SPECS[prov].profile(t)))(p, token);
  } catch {
    return fail();
  }

  const linked = await prisma.oAuthAccount.findUnique({
    where: { provider_providerUserId: { provider: p, providerUserId: profile.id } },
  });

  if (pending.intent === "link") {
    if (!pending.userId) return fail();
    if (linked && linked.userId !== pending.userId) return fail(XEC.AUTH_OAUTH_EMAIL_TAKEN);
    await prisma.oAuthAccount.upsert({
      where: { userId_provider: { userId: pending.userId, provider: p } },
      update: { providerUserId: profile.id, email: profile.email },
      create: { userId: pending.userId, provider: p, providerUserId: profile.id, email: profile.email },
    });
    return { kind: "linked", provider: p, returnTo: pending.returnTo };
  }

  if (linked) {
    await prisma.oAuthAccount.update({ where: { id: linked.id }, data: { lastUsedAt: new Date() } });
    const result = await finishSignIn(linked.userId, ctx, { method: "oauth", persistent: pending.persistent });
    return { kind: "signin", result, returnTo: pending.returnTo };
  }

  // Nobody here has this provider account yet: a new member, if registration
  // allows it and the address is verified and free.
  if (!profile.email || !profile.emailVerified) return fail();
  const taken = await prisma.user.findFirst({ where: { email: { equals: profile.email, mode: "insensitive" } }, select: { id: true } });
  if (taken) return fail(XEC.AUTH_OAUTH_EMAIL_TAKEN);

  let guardAuthorised: boolean;
  try {
    guardAuthorised = await authGuardRegistry.beforeRegister({
      ip: ctx.ip ?? "", userAgent: ctx.userAgent ?? null, cookies: ctx.cookies ?? {},
    });
  } catch (err) {
    // A guard that refuses throws its own reason (a beta gate's code, say): pass it on.
    return fail(err instanceof XentiumError ? err.code : XEC.AUTH_REGISTRATION_CLOSED);
  }
  if (!guardAuthorised) {
    const mode = await getSetting("auth.registration_mode", "open");
    // Invite mode needs a code this flow cannot carry; closed is closed.
    if (mode !== "open") return fail(mode === "invite" ? XEC.AUTH_INVITE_REQUIRED : XEC.AUTH_REGISTRATION_CLOSED);
  }

  const userId = await createMember(p, profile, ctx);
  const result = await finishSignIn(userId, ctx, { method: "oauth", persistent: pending.persistent });
  return { kind: "signin", result, returnTo: pending.returnTo };
}

/** A username from the provider's handle, made valid and unique. */
export async function deriveUsername(profile: ProviderProfile): Promise<string> {
  const seed = (profile.handle || profile.name || profile.email?.split("@")[0] || "member")
    .normalize("NFKD").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^[_-]+|[_-]+$/g, "").slice(0, 24);
  const base = seed.length >= 3 ? seed : `member_${seed}`.slice(0, 24);
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}_${i + 1}`;
    const clash = await prisma.user.findFirst({ where: { username: { equals: candidate, mode: "insensitive" } }, select: { id: true } });
    if (!clash) return candidate;
  }
  return `${base.slice(0, 18)}_${crypto.randomBytes(3).toString("hex")}`;
}

async function createMember(p: OAuthProvider, profile: ProviderProfile, ctx: SignInContext): Promise<string> {
  const username = await deriveUsername(profile);
  const defaultGroupKey = await getSetting("auth.default_group", "member");
  const group = await prisma.group.findFirst({ where: { key: String(defaultGroupKey) } });
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        email: profile.email!,
        username,
        displayName: profile.name?.slice(0, 80) || null,
        // No password: "!" never verifies. They can set one with a reset link.
        passwordHash: `!oauth:${crypto.randomBytes(24).toString("hex")}`,
        isActive: true,
        emailVerifiedAt: new Date(),
      },
    });
    if (group) await tx.userGroup.create({ data: { userId: u.id, groupId: group.id } });
    await tx.oAuthAccount.create({ data: { userId: u.id, provider: p, providerUserId: profile.id, email: profile.email } });
    return u;
  });
  await authGuardRegistry.afterRegister({ ip: ctx.ip ?? "", userAgent: ctx.userAgent ?? null, cookies: ctx.cookies ?? {}, userId: user.id });
  await prisma.loginEvent.create({
    data: { userId: user.id, emailAttempted: user.email, success: true, eventType: "register", ip: ctx.ip, userAgent: ctx.userAgent, deviceCookieId: ctx.deviceCookieId },
  }).catch(() => null);
  return user.id;
}

// ── Linked accounts (signed in) ──────────────────────────────────────────────

export async function linkedAccounts(userId: string) {
  return prisma.oAuthAccount.findMany({
    where: { userId }, orderBy: { createdAt: "asc" },
    select: { provider: true, email: true, createdAt: true, lastUsedAt: true },
  });
}

export async function unlink(userId: string, p: OAuthProvider) {
  const row = await prisma.oAuthAccount.findUnique({ where: { userId_provider: { userId, provider: p } } });
  if (!row) throw XentiumError.notFound("Not connected");
  await assertKeepsASignInMethod(userId, { provider: p });
  await prisma.oAuthAccount.delete({ where: { id: row.id } });
}

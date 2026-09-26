import type { Request, Response } from "express";
import { z } from "zod";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { env } from "../../config/env.js";
import { prisma } from "../../infrastructure/db.js";
import { redis, rkey } from "../../infrastructure/redis.js";
import { getSetting } from "../../shared/utils/settings.js";
import { resolveAvatar } from "../../shared/utils/resolveAvatar.js";
import { ONLINE_TTL_MS } from "../../shared/middleware/requireAuth.js";
import { getRequestMeta } from "../../shared/http/requestMeta.js";
import { setRefreshCookie } from "../../shared/http/cookies.js";
import { isEmailConfigured } from "../../infrastructure/email/email.service.js";
import { XEC } from "../../shared/errors/xec.js";
import { respondSignIn, type SignInContext } from "./auth.signin.js";
import {
  authenticationOptions, listPasskeys, registrationOptions, relyingParty,
  removePasskey, renamePasskey, verifyAuthentication, verifyRegistration,
} from "./passkey.service.js";
import {
  OAUTH_STATE_COOKIE, enabledProviders, handleCallback, isProvider, linkedAccounts,
  providerConfigView, startFlow, unlink, updateProviderConfig, type OAuthProvider,
} from "./oauth.service.js";
import { signInMethodsOf } from "./signInMethods.service.js";

// Passkeys, sign-in providers and the "which methods exist here" answer. The
// password, PIN-step and sign-in-link handlers live in auth.controller.ts.

const prod = env.NODE_ENV === "production";
const appUrl = () => env.APP_URL.replace(/\/$/, "");

function ctxOf(req: Request, res: Response): SignInContext {
  return { ...getRequestMeta(req, res), cookies: (req.signedCookies ?? {}) as Record<string, string> };
}

// A WebAuthn response is the browser's JSON, verified cryptographically by the
// library — we only bound its shape and size here.
const webauthnResponse = z.object({
  id: z.string().min(1).max(1024),
  rawId: z.string().min(1).max(1024),
  type: z.literal("public-key"),
  response: z.record(z.string(), z.unknown()),
}).passthrough();

const providerParam = z.object({ provider: z.string() }).transform((p, c) => {
  if (!isProvider(p.provider)) { c.addIssue({ code: "custom", message: "Unknown provider" }); return z.NEVER; }
  return p.provider as OAuthProvider;
});

// ── What this install offers ────────────────────────────────────────────────

/** Public: the sign-in page shows only the buttons that work here. */
export async function methodsHandler(_req: Request, res: Response) {
  res.json({
    passkeys: relyingParty().available,
    // Without SMTP a link can only reach the server log, which is fine while
    // developing and useless in production.
    magicLink: (await isEmailConfigured()) || !prod,
    providers: await enabledProviders(),
  });
}

// ── The welcome side of the sign-in page ────────────────────────────────────

let doorwayCache: { at: number; body: unknown } | null = null;
const DOORWAY_TTL_MS = 60_000;

/**
 * Public: the numbers and faces beside the sign-in form. Cached a minute — the
 * page is public and hit constantly. A member whose profile is members-only is
 * never shown here (they still count toward the week's number, which names
 * nobody).
 */
export async function doorwayHandler(_req: Request, res: Response) {
  if (doorwayCache && Date.now() - doorwayCache.at < DOORWAY_TTL_MS) { res.json(doorwayCache.body); return; }
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000);
  const [members, joinedThisWeek, newest, onlineCount] = await Promise.all([
    prisma.user.count({ where: { isActive: true } }),
    prisma.user.count({ where: { isActive: true, createdAt: { gte: weekAgo } } }),
    prisma.user.findMany({
      where: { isActive: true, createdAt: { gte: weekAgo } },
      orderBy: { createdAt: "desc" }, take: 12,
      select: { id: true, username: true, avatar: true },
    }),
    // Presence is a sorted set of last-seen times — the same window the online list uses.
    redis.zcount(rkey("online:users"), Date.now() - ONLINE_TTL_MS, "+inf").catch(() => 0),
  ]);
  const privacy = await prisma.userPrivacySettings.findMany({ where: { userId: { in: newest.map((u) => u.id) } } });
  const membersOnly = new Set(privacy
    .filter((p) => (p.settings as Record<string, unknown> | null)?.profileVisibility === "members")
    .map((p) => p.userId));
  const body = {
    siteName: await getSetting<string>("site.name", "Xentium"),
    tagline: await getSetting<string>("site.description", ""),
    members, online: onlineCount, joinedThisWeek,
    recent: newest.filter((u) => !membersOnly.has(u.id)).slice(0, 4)
      .map((u) => ({ username: u.username, avatar: resolveAvatar(u.avatar) })),
  };
  doorwayCache = { at: Date.now(), body };
  res.json(body);
}

// ── Passkeys ─────────────────────────────────────────────────────────────────

export async function passkeyLoginOptionsHandler(_req: Request, res: Response) {
  res.json(await authenticationOptions());
}

export async function passkeyLoginVerifyHandler(req: Request, res: Response) {
  const body = z.object({
    ceremonyId: z.string().min(10).max(64),
    response: webauthnResponse,
    remember: z.boolean().optional().default(true),
  }).parse(req.body);
  const result = await verifyAuthentication(body.ceremonyId, body.response as unknown as AuthenticationResponseJSON, ctxOf(req, res), body.remember);
  respondSignIn(res, result);
}

export async function passkeyRegisterOptionsHandler(req: Request, res: Response) {
  res.json(await registrationOptions(req.userId!));
}

export async function passkeyRegisterVerifyHandler(req: Request, res: Response) {
  const body = z.object({ response: webauthnResponse, name: z.string().max(60).optional().default("") }).parse(req.body);
  res.status(201).json(await verifyRegistration(req.userId!, body.response as unknown as RegistrationResponseJSON, body.name));
}

export async function passkeyRenameHandler(req: Request, res: Response) {
  const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
  const { name } = z.object({ name: z.string().min(1).max(60) }).parse(req.body);
  await renamePasskey(req.userId!, id, name);
  res.json({ ok: true });
}

export async function passkeyRemoveHandler(req: Request, res: Response) {
  const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
  await removePasskey(req.userId!, id);
  res.json({ ok: true });
}

/** Signed in: every way this member can get back in, for account settings. */
export async function mySignInMethodsHandler(req: Request, res: Response) {
  const [m, passkeys, providers, available] = await Promise.all([
    signInMethodsOf(req.userId!), listPasskeys(req.userId!), linkedAccounts(req.userId!), enabledProviders(),
  ]);
  res.json({
    password: m.password, passkeys, providers,
    available: { passkeys: relyingParty().available, providers: available },
  });
}

// ── Sign-in providers ────────────────────────────────────────────────────────

function setStateCookie(res: Response, state: string) {
  res.cookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true, secure: prod, signed: true,
    // Lax, not Strict: the provider's redirect back is a cross-site top-level
    // navigation, and a Strict cookie would not come with it.
    sameSite: "lax", path: "/api/auth/oauth", maxAge: 10 * 60_000,
  });
}

export async function oauthStartHandler(req: Request, res: Response) {
  const provider = providerParam.parse(req.params);
  const body = z.object({ remember: z.boolean().optional().default(true), returnTo: z.string().max(500).optional() }).parse(req.body ?? {});
  const { url, state } = await startFlow(provider, { intent: "signin", persistent: body.remember, returnTo: body.returnTo });
  setStateCookie(res, state);
  res.json({ url });
}

export async function oauthLinkHandler(req: Request, res: Response) {
  const provider = providerParam.parse(req.params);
  const body = z.object({ returnTo: z.string().max(500).optional() }).parse(req.body ?? {});
  const { url, state } = await startFlow(provider, { intent: "link", userId: req.userId!, persistent: true, returnTo: body.returnTo ?? "/account" });
  setStateCookie(res, state);
  res.json({ url });
}

export async function oauthUnlinkHandler(req: Request, res: Response) {
  const provider = providerParam.parse(req.params);
  await unlink(req.userId!, provider);
  res.json({ ok: true });
}

/** Append query parameters to a same-site path. */
function withQuery(path: string, params: Record<string, string>): string {
  const url = new URL(path, "http://x");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return `${url.pathname}${url.search}`;
}

/**
 * The provider sends the browser here. Everything ends in a redirect to the SPA
 * with the outcome in the query string — never a token: the session travels
 * only in the httpOnly refresh cookie, and the page asks /auth/refresh for it.
 */
export async function oauthCallbackHandler(req: Request, res: Response) {
  const provider = providerParam.parse(req.params);
  const q = z.object({ code: z.string().max(2048).optional(), state: z.string().max(128).optional(), error: z.string().max(200).optional() })
    .parse(req.query);
  const cookieState = (req.signedCookies ?? {})[OAUTH_STATE_COOKIE] as string | undefined;
  res.clearCookie(OAUTH_STATE_COOKIE, { path: "/api/auth/oauth" });

  const outcome = await handleCallback(provider, q, cookieState, ctxOf(req, res));
  const go = (path: string) => res.redirect(302, `${appUrl()}${path}`);

  if (outcome.kind === "error") {
    return go(outcome.intent === "link"
      ? withQuery(outcome.returnTo, { oauthError: outcome.code })
      : withQuery("/login", { error: outcome.code }));
  }
  if (outcome.kind === "linked") return go(withQuery(outcome.returnTo, { connected: outcome.provider }));

  const r = outcome.result;
  if (r.kind === "banned") return go(withQuery("/login", { error: r.expiresAt ? XEC.AUTH_BANNED : XEC.AUTH_BANNED_PERMANENT }));
  if (r.kind === "pin") return go(withQuery("/login/complete", { pin: r.ticket, to: outcome.returnTo }));
  setRefreshCookie(res, r.refreshToken, r.persistent);
  return go(withQuery("/login/complete", { to: outcome.returnTo }));
}

// ── ACP ──────────────────────────────────────────────────────────────────────

export async function adminProvidersHandler(_req: Request, res: Response) {
  res.json({ providers: await providerConfigView(), passkeys: relyingParty() });
}

export async function adminProviderUpdateHandler(req: Request, res: Response) {
  const provider = providerParam.parse(req.params);
  const body = z.object({
    enabled: z.boolean().optional(),
    clientId: z.string().max(300).optional(),
    // null removes the secret; absent leaves it untouched.
    clientSecret: z.string().min(1).max(500).nullable().optional(),
  }).parse(req.body);
  await updateProviderConfig(provider, body);
  res.json({ providers: await providerConfigView() });
}


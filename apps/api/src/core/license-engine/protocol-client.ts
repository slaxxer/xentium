// The signed transport to the marketplace — protocol v1 (the marketplace repo's
// `/api/v1`). Every module that talks to the marketplace goes through here, so
// there is exactly one place that knows how a request is authenticated.
//
// TWO credentials, and they answer different questions:
//
//   • the account token (Bearer) says WHO is calling,
//   • the Ed25519 signature PROVES the caller is that install.
//
// That second half is what makes install-binding defensible. A licence binds to
// `siteId`, not to a hostname — domains change on rebrands, migrations and
// staging promotions and each would otherwise be a support ticket. But without
// a signature `siteId` is just a string in a JSON body, and anyone holding a
// leaked token could claim any install. The two decisions are a package.
//
// The keypair is generated here, once, at connect. The private half never
// leaves this instance and is encrypted at rest (A1.5); the public half is
// registered with the marketplace and is all it ever holds.

import crypto from "node:crypto";
import { prisma } from "../../infrastructure/db.js";
import { env } from "../../config/env.js";
import { logger } from "../../infrastructure/logging/logger.js";
import { bustSettingsCache } from "../../shared/utils/settings.js";
import { encryptSecret, decryptSecret } from "../../shared/utils/secretBox.js";
import { NodevoError } from "../../shared/errors/NodevoError.js";
import { NEC, type NecCode } from "../../shared/errors/nec.js";
import { getSiteId } from "./site-identity.js";

/** The one marketplace source id core ships with. */
export const SOURCE_ID = "nodevo.io";

// Settings keys for the server-side connection. NONE of these are ever exposed
// to the browser — the ACP asks the API about the connection, never for it.
export const K_TOKEN   = `marketplace.${SOURCE_ID}.token`;       // encrypted
export const K_REF     = `marketplace.${SOURCE_ID}.accountRef`;
export const K_AT      = `marketplace.${SOURCE_ID}.connectedAt`;
export const K_PRIVKEY = `marketplace.${SOURCE_ID}.privateKey`;  // encrypted (PKCS8 PEM)
export const K_PUBKEY  = `marketplace.${SOURCE_ID}.publicKey`;   // base64 SPKI DER

/** Keys whose stored value is ciphertext. */
const ENCRYPTED = new Set<string>([K_TOKEN, K_PRIVKEY]);

export async function readSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  const value = (row?.value as string | null) ?? null;
  // decryptSecret passes through legacy plaintext unchanged, so values written
  // before encryption keep working until their next write.
  return value !== null && ENCRYPTED.has(key) ? decryptSecret(value) : value;
}

export async function writeSetting(key: string, value: string | null): Promise<void> {
  if (value === null) {
    await prisma.setting.deleteMany({ where: { key } });
  } else {
    const stored = ENCRYPTED.has(key) ? encryptSecret(value) : value;
    await prisma.setting.upsert({ where: { key }, update: { value: stored }, create: { key, value: stored } });
  }
  bustSettingsCache(key);
}

// ── Install keypair ──────────────────────────────────────────────────────────

/**
 * This install's signing keypair, generated on first use.
 *
 * A reinstall legitimately produces a new keypair for the same siteId, and the
 * marketplace accepts that at connect — which is also why the key is only ever
 * REGISTERED there, never escrowed: losing it costs a reconnect, not a licence.
 */
export async function getOrCreateKeypair(): Promise<{ privateKeyPem: string; publicKeyB64: string }> {
  const [privateKeyPem, publicKeyB64] = await Promise.all([
    readSetting(K_PRIVKEY),
    readSetting(K_PUBKEY),
  ]);
  if (privateKeyPem && publicKeyB64) return { privateKeyPem, publicKeyB64 };

  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  // SPKI DER, base64 — exactly what the marketplace feeds back into
  // createPublicKey({ format: "der", type: "spki" }).
  const b64 = publicKey.export({ format: "der", type: "spki" }).toString("base64");

  await writeSetting(K_PRIVKEY, pem);
  await writeSetting(K_PUBKEY, b64);
  logger.info({ source: SOURCE_ID }, "Marketplace install keypair generated");

  return { privateKeyPem: pem, publicKeyB64: b64 };
}

/** Drop every credential this install holds for the marketplace. */
export async function clearIdentity(): Promise<void> {
  for (const key of [K_TOKEN, K_REF, K_AT, K_PRIVKEY, K_PUBKEY]) {
    await writeSetting(key, null);
  }
}

export const getAccountToken = () => readSetting(K_TOKEN);
export const setAccountToken = (token: string | null) => writeSetting(K_TOKEN, token);

// ── Transport ────────────────────────────────────────────────────────────────

/** `https://host/api/v1` + `/account/activate` → one URL, no doubled slashes. */
function buildUrl(path: string): URL {
  const base = env.LICENSE_SERVER_URL.replace(/\/+$/, "");
  return new URL(`${base}${path.startsWith("/") ? path : `/${path}`}`);
}

/**
 * Map a marketplace response to a coded NodevoError.
 *
 * 5xx is unreachable-class (grace applies, nothing is refused); 4xx is an
 * explicit refusal whose message names the reason, and is surfaced as-is —
 * "no free seat" and "that code expired" are things an admin can act on, and
 * flattening them into one generic failure is how support tickets are made.
 */
const KNOWN_CODES = new Set<string>(Object.values(NEC));

async function protocolError(res: Response): Promise<NodevoError> {
  const body = await res.json().catch(() => ({})) as { error?: { message?: string; code?: string }; message?: string };
  const message = body.error?.message ?? body.message ?? `Marketplace returned ${res.status}`;

  if (res.status >= 500) {
    return new NodevoError({ code: NEC.LICENSE_SOURCE_UNREACHABLE, httpStatus: 503, message });
  }

  // Both halves speak NEC, so prefer the code the marketplace NAMED over one
  // guessed from the status. A 403 is "lapsed updates" or "you are signing for
  // another install" depending on the call, and flattening them loses the one
  // thing the ACP's error reference can explain. Unknown codes fall through:
  // a newer marketplace must not be able to inject an unrecognised one.
  const named = body.error?.code;
  if (named && KNOWN_CODES.has(named)) {
    return new NodevoError({ code: named as NecCode, httpStatus: res.status, message });
  }

  const code: NecCode =
      res.status === 401 ? NEC.LICENSE_ACCOUNT_REQUIRED
    : res.status === 403 ? NEC.LICENSE_TOKEN_INVALID
    : res.status === 402 ? NEC.LICENSE_CAP_REACHED
    : res.status === 409 ? NEC.LICENSE_DOMAIN_MISMATCH
    : res.status === 404 ? NEC.LICENSE_NOT_FOUND
    : NEC.LICENSE_SERVER_REJECTED;

  return new NodevoError({ code, httpStatus: res.status, message });
}

interface ProtocolRequest {
  method:    "GET" | "POST";
  path:      string;                      // relative to LICENSE_SERVER_URL, e.g. "/account/activate"
  body?:     unknown;
  query?:    Record<string, string | number | undefined>;
  /** Sign + authenticate. Only `/account/connect` sets this false. */
  signed?:   boolean;
  /** Send the Bearer token if we hold one, but don't require it. */
  optionalToken?: boolean;
  timeoutMs?: number;
}

/**
 * One request to the marketplace, signed unless told otherwise.
 *
 * The canonical string the marketplace verifies is
 *
 *     {METHOD}\n{pathname}\n{timestamp}\n{sha256(body bytes)}
 *
 * — note *pathname*, which includes the `/api/v1` prefix, because the server
 * rebuilds it from `req.baseUrl + req.path`. Taking it from the URL rather than
 * from `path` means the base path can move without silently breaking every
 * signature. And the body is serialized ONCE: re-serializing the parsed object
 * would produce different bytes and a hash the server cannot match.
 */
export async function protocolFetch<T>(req: ProtocolRequest): Promise<T> {
  const {
    method, path, body, query,
    signed = true, optionalToken = false, timeoutMs = 15_000,
  } = req;

  const url = buildUrl(path);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  const payload  = body === undefined ? "" : JSON.stringify(body);
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const token = signed || optionalToken ? await getAccountToken() : null;
  if (signed && !token) {
    throw new NodevoError({
      code: NEC.LICENSE_ACCOUNT_REQUIRED, httpStatus: 400,
      message: "No marketplace account is connected. Connect one in ACP → Extensions → License.",
    });
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  if (signed) {
    const [siteId, { privateKeyPem }] = await Promise.all([getSiteId(), getOrCreateKeypair()]);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const bodyHash  = crypto.createHash("sha256").update(payload, "utf8").digest("hex");
    const canonical = [method, url.pathname, timestamp, bodyHash].join("\n");
    const signature = crypto.sign(null, Buffer.from(canonical, "utf8"), crypto.createPrivateKey(privateKeyPem));

    headers["X-Nodevo-Site"]      = siteId;
    headers["X-Nodevo-Timestamp"] = timestamp;
    headers["X-Nodevo-Signature"] = signature.toString("base64");
  }

  const res = await fetch(url, {
    method,
    headers,
    ...(body === undefined ? {} : { body: payload }),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => null);

  if (!res) {
    throw new NodevoError({
      code: NEC.LICENSE_SOURCE_UNREACHABLE, httpStatus: 503,
      message: "Could not reach the marketplace.",
    });
  }
  if (!res.ok) throw await protocolError(res);
  if (res.status === 204) return undefined as T;

  return await res.json() as T;
}

/**
 * Persist a token the marketplace handed back mid-conversation.
 *
 * Rotation rides the heartbeat (`/updates/check`) — the one recurring call — so
 * there is no second path that could desynchronise the credential. The
 * marketplace keeps the previous token alive for a short overlap, so a crash
 * between "response received" and "token written" costs one retry, not a
 * disconnected install.
 */
export async function acceptRotatedToken(token: string | undefined): Promise<void> {
  if (!token) return;
  await setAccountToken(token);
  logger.info({ source: SOURCE_ID }, "Marketplace account token rotated");
}

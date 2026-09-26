import crypto from "node:crypto";
import {
  generateAuthenticationOptions, generateRegistrationOptions,
  verifyAuthenticationResponse, verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { prisma } from "../../infrastructure/db.js";
import { redis, rkey } from "../../infrastructure/redis.js";
import { env } from "../../config/env.js";
import { getSetting } from "../../shared/utils/settings.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { XEC } from "../../shared/errors/xec.js";
import { finishSignIn, type SignInContext, type SignInResult } from "./auth.signin.js";
import { assertKeepsASignInMethod } from "./signInMethods.service.js";

/**
 * Passkeys (WebAuthn). The member's device keeps the private key; we keep the
 * public key and a counter. Two ceremonies, each a challenge we issue, the
 * browser signs, and we verify — the challenge lives five minutes in Redis and
 * is used once.
 *
 * The relying party is the site's public address (APP_URL): a passkey is bound
 * to that hostname, and browsers only allow the ceremony on a secure origin
 * (https, or localhost while developing).
 */

const CHALLENGE_TTL_SEC = 300;

export function relyingParty() {
  const url = new URL(env.APP_URL);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname.endsWith(".localhost");
  return { rpID: url.hostname, origin: url.origin, available: url.protocol === "https:" || local };
}

function assertAvailable() {
  if (!relyingParty().available) {
    throw new XentiumError({ code: XEC.AUTH_PASSKEY_UNAVAILABLE, httpStatus: 400, message: "Passkeys need the site to be served over https" });
  }
}

const failed = (message = "Passkey could not be verified") =>
  new XentiumError({ code: XEC.AUTH_PASSKEY_FAILED, httpStatus: 400, message, persist: false });

const regKey = (userId: string) => rkey(`auth:passkey:reg:${userId}`);
const authKey = (ceremony: string) => rkey(`auth:passkey:auth:${ceremony}`);

// ── Adding a passkey (signed in) ─────────────────────────────────────────────

export async function registrationOptions(userId: string) {
  assertAvailable();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, email: true, passkeys: { select: { credentialId: true, transports: true } } },
  });
  if (!user) throw failed();
  const { rpID } = relyingParty();
  const options = await generateRegistrationOptions({
    rpName: await getSetting<string>("site.name", "Xentium"),
    rpID,
    userName: user.email,
    userDisplayName: user.username,
    // The user handle is our user id: a discoverable passkey hands it back at
    // sign-in, which is how we know whose key it is without asking for a name.
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    excludeCredentials: user.passkeys.map((p) => ({ id: p.credentialId, transports: p.transports })),
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
  await redis.set(regKey(userId), options.challenge, "EX", CHALLENGE_TTL_SEC);
  return options;
}

export async function verifyRegistration(userId: string, response: RegistrationResponseJSON, name: string) {
  assertAvailable();
  const expectedChallenge = await redis.getdel(regKey(userId));
  if (!expectedChallenge) throw failed("The passkey request expired. Try again.");
  const { rpID, origin } = relyingParty();
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false,
    });
  } catch {
    throw failed();
  }
  if (!verification.verified) throw failed();
  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const row = await prisma.passkey.create({
    data: {
      userId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: BigInt(credential.counter),
      transports: credential.transports ?? [],
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      name: name.trim().slice(0, 60) || "Passkey",
    },
  });
  return toView(row);
}

// ── Signing in with a passkey ────────────────────────────────────────────────

/** Anonymous: the browser offers whichever passkey for this site the member picks. */
export async function authenticationOptions() {
  assertAvailable();
  const { rpID } = relyingParty();
  const options = await generateAuthenticationOptions({ rpID, userVerification: "preferred" });
  const ceremonyId = crypto.randomBytes(18).toString("base64url");
  await redis.set(authKey(ceremonyId), options.challenge, "EX", CHALLENGE_TTL_SEC);
  return { ceremonyId, options };
}

export async function verifyAuthentication(
  ceremonyId: string, response: AuthenticationResponseJSON, ctx: SignInContext, persistent: boolean,
): Promise<SignInResult> {
  assertAvailable();
  const expectedChallenge = await redis.getdel(authKey(ceremonyId));
  if (!expectedChallenge) throw failed("The passkey request expired. Try again.");
  const passkey = await prisma.passkey.findUnique({ where: { credentialId: response.id } });
  if (!passkey) throw failed("This passkey isn't registered here.");

  const { rpID, origin } = relyingParty();
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false,
      credential: {
        id: passkey.credentialId, publicKey: new Uint8Array(passkey.publicKey),
        counter: Number(passkey.counter), transports: passkey.transports,
      },
    });
  } catch {
    // Includes a counter that went backwards: the library refuses a cloned key.
    throw failed();
  }
  if (!verification.verified) throw failed();

  await prisma.passkey.update({
    where: { id: passkey.id },
    data: { counter: BigInt(verification.authenticationInfo.newCounter), lastUsedAt: new Date() },
  });
  // A passkey the device unlocked with a fingerprint, face or device PIN is
  // already two factors; one that was merely touched is not, and still meets
  // the member's login PIN.
  return finishSignIn(passkey.userId, ctx, {
    method: "passkey", persistent, pinVerified: verification.authenticationInfo.userVerified,
  });
}

// ── Managing passkeys (signed in) ────────────────────────────────────────────

type PasskeyRow = { id: string; name: string; deviceType: string; backedUp: boolean; createdAt: Date; lastUsedAt: Date | null };
function toView(p: PasskeyRow) {
  return { id: p.id, name: p.name, synced: p.deviceType === "multiDevice" || p.backedUp, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt };
}

export async function listPasskeys(userId: string) {
  const rows = await prisma.passkey.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  return rows.map(toView);
}

export async function renamePasskey(userId: string, id: string, name: string) {
  const { count } = await prisma.passkey.updateMany({ where: { id, userId }, data: { name: name.trim().slice(0, 60) || "Passkey" } });
  if (count === 0) throw XentiumError.notFound("Passkey not found");
}

export async function removePasskey(userId: string, id: string) {
  const row = await prisma.passkey.findFirst({ where: { id, userId }, select: { id: true } });
  if (!row) throw XentiumError.notFound("Passkey not found");
  await assertKeepsASignInMethod(userId, { passkeyId: id });
  await prisma.passkey.delete({ where: { id } });
}

import { prisma } from "../../infrastructure/db.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { XEC } from "../../shared/errors/xec.js";

/**
 * Which ways a member can get back in, and the one rule about removing them:
 * never the last. An account created through Google has no password; take away
 * its Google link and nobody can sign in to it again.
 *
 * "No password" follows the convention the importers started: a hash beginning
 * with "!" can never verify (`!imported:…`, `!oauth:…`).
 */

export const hasUsablePassword = (passwordHash: string) => !passwordHash.startsWith("!");

export async function signInMethodsOf(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      passwordHash: true,
      passkeys: { select: { id: true } },
      oauthAccounts: { select: { provider: true } },
    },
  });
  if (!user) throw XentiumError.notFound("User not found");
  return {
    password: hasUsablePassword(user.passwordHash),
    passkeys: user.passkeys.map((p) => p.id),
    providers: user.oauthAccounts.map((o) => o.provider),
  };
}

/** Throws if removing this passkey or provider would leave no way to sign in. */
export async function assertKeepsASignInMethod(userId: string, removing: { passkeyId?: string; provider?: string }) {
  const m = await signInMethodsOf(userId);
  const remaining =
    (m.password ? 1 : 0)
    + m.passkeys.filter((id) => id !== removing.passkeyId).length
    + m.providers.filter((p) => p !== removing.provider).length;
  if (remaining === 0) {
    throw new XentiumError({
      code: XEC.AUTH_LAST_SIGNIN_METHOD, httpStatus: 409,
      message: "This is your only way to sign in. Set a password or add another method first.",
    });
  }
}

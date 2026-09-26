/**
 * Passkeys, as far as they can be exercised without an authenticator: the
 * options we hand the browser, one-time challenges, unknown credentials, and
 * the rule that the last sign-in method cannot be removed. The cryptographic
 * verification itself is @simplewebauthn's, and is exercised in the browser.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { XEC } from "../../shared/errors/xec.js";
import { hashPassword } from "./auth.password.js";
import {
  authenticationOptions, registrationOptions, relyingParty, removePasskey, verifyAuthentication, verifyRegistration,
} from "./passkey.service.js";

const EMAIL = "passkey-probe@example.test";
let userId: string;
const fakeResponse = { id: "AAAA", rawId: "AAAA", type: "public-key", response: {}, clientExtensionResults: {} } as never;

beforeEach(async () => {
  assertDisposableDatabase();
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  userId = (await prisma.user.create({ data: { email: EMAIL, username: "passkey_probe", passwordHash: `!oauth:none` } })).id;
});
afterEach(async () => { await prisma.user.deleteMany({ where: { email: EMAIL } }); });

describe("passkeys", () => {
  it("are available on localhost while developing", () => {
    expect(relyingParty()).toMatchObject({ rpID: "localhost", available: true });
  });

  it("registration options carry a challenge and exclude keys already registered", async () => {
    await prisma.passkey.create({ data: { userId, credentialId: "existing-cred", publicKey: Buffer.from([1]), deviceType: "multiDevice", name: "Phone" } });
    const options = await registrationOptions(userId);
    expect(options.challenge.length).toBeGreaterThan(10);
    expect(options.excludeCredentials?.map((c) => c.id)).toEqual(["existing-cred"]);
    expect(options.authenticatorSelection?.residentKey).toBe("required");
  });

  it("a registration challenge is used once", async () => {
    await registrationOptions(userId);
    await expect(verifyRegistration(userId, fakeResponse, "x")).rejects.toMatchObject({ code: XEC.AUTH_PASSKEY_FAILED });
    await expect(verifyRegistration(userId, fakeResponse, "x")).rejects.toThrow(/expired/);
  });

  it("refuses a credential nobody registered", async () => {
    const { ceremonyId } = await authenticationOptions();
    await expect(verifyAuthentication(ceremonyId, fakeResponse, {}, true)).rejects.toThrow(/isn't registered/);
  });

  it("will not remove the only passkey of an account without a password", async () => {
    const pk = await prisma.passkey.create({ data: { userId, credentialId: "only-cred", publicKey: Buffer.from([1]), deviceType: "multiDevice", name: "Phone" } });
    await expect(removePasskey(userId, pk.id)).rejects.toMatchObject({ code: XEC.AUTH_LAST_SIGNIN_METHOD });
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword("password-123") } });
    await expect(removePasskey(userId, pk.id)).resolves.toBeUndefined();
  });
});

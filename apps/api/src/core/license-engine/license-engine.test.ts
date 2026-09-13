/**
 * `getSiteId` — the install identity every license-server call is made under.
 *
 * This exists as a regression guard, not for coverage. The function used to
 * return the literal string "dev-site" when `ncf_installs` had no row, and that
 * fallback is a SHARED identity: every affected install reports as the same
 * site, so activations, per-domain caps and audit trails from all of them
 * collapse into one bucket on the marketplace. Once entitlements bind to the
 * siteId rather than the hostname it stops being a collision and becomes a
 * license bypass.
 *
 * The failure mode is that the fallback looks like a kindness — it is exactly
 * what somebody restores to unblock a local environment that will not activate.
 * Pinning it here makes that show up as a failing test rather than as an
 * anomaly in the marketplace's numbers months later.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { XEC } from "@xentium/contracts";

const install: { siteId: string | null } = { siteId: null };

vi.mock("../../infrastructure/db.js", () => ({
  prisma: {
    install: { findFirst: async () => (install.siteId === null ? null : { siteId: install.siteId }) },
  },
}));

const { getSiteId } = await import("./license-engine.js");

beforeEach(() => {
  install.siteId = null;
});

describe("getSiteId", () => {
  it("returns the install's UUID", async () => {
    install.siteId = "9f1c8a04-1c2b-4d3e-9f10-abcdef012345";
    await expect(getSiteId()).resolves.toBe("9f1c8a04-1c2b-4d3e-9f10-abcdef012345");
  });

  it("throws rather than falling back to a shared identity", async () => {
    // Asserted this way round so a regression names the placeholder it resolved
    // with ("dev-site", or whatever the next well-meaning fallback is) instead
    // of just reporting that a rejection was expected.
    await getSiteId().then(
      (value) => expect.unreachable(`resolved with "${value}" instead of throwing`),
      () => { /* expected */ },
    );
  });

  it("carries the coded error so the ACP error reference can explain it", async () => {
    await expect(getSiteId()).rejects.toMatchObject({ code: XEC.LICENSE_SITE_ID_MISSING });
  });

  it("throws when the row exists but carries no siteId", async () => {
    install.siteId = "";
    await expect(getSiteId()).rejects.toMatchObject({ code: XEC.LICENSE_SITE_ID_MISSING });
  });
});

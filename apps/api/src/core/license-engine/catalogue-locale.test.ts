/**
 * The ACP marketplace asks the store for listing texts in the admin's language:
 * the browse request carries `locale` when the admin's ACP sent one, and nothing
 * extra when it did not (an older store ignores the parameter either way).
 */
import { describe, expect, it, vi } from "vitest";

const protocolFetch = vi.fn(async (_req: { query?: Record<string, unknown> }) => ({ data: [], meta: { totalPages: 1 } }));

vi.mock("../../infrastructure/db.js", () => ({ prisma: { setting: { findUnique: async () => null, upsert: async () => ({}) } } }));
vi.mock("./protocol-client.js", () => ({
  SOURCE_ID: "xentium.org",
  K_REF: "ref", K_AT: "at",
  clearIdentity: async () => {},
  getAccountToken: async () => "tok",
  getOrCreateKeypair: async () => ({ privateKeyPem: "", publicKeyB64: "" }),
  setAccountToken: async () => {},
  readSetting: async () => null,
  getSiteDomain: async () => "example.test",
  resolveEnvironment: async () => "production",
  marketplaceWebUrl: (p = "/") => `https://store.test${p}`,
  get protocolFetch() { return protocolFetch; },
}));

const { marketplaceSource } = await import("./marketplace-source.js");

describe("browsing the store from the ACP", () => {
  it("asks in the admin's language", async () => {
    await marketplaceSource.listPlugins({ page: 1, limit: 24, kind: "plugin", locale: "de" });
    expect(protocolFetch.mock.calls.at(-1)![0].query).toMatchObject({ kind: "plugin", locale: "de" });
  });

  it("sends no language when the ACP gave none", async () => {
    await marketplaceSource.listPlugins({ page: 1, limit: 24, kind: "plugin" });
    expect(protocolFetch.mock.calls.at(-1)![0].query).not.toHaveProperty("locale");
  });
});

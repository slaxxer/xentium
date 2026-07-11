import { describe, it, expect } from "vitest";
import { securityScanRegistry } from "./security-scan-registry.js";

describe("securityScanRegistry pattern claims", () => {
  it("reports claimed patterns while the plugin is registered", () => {
    securityScanRegistry.claimPatterns("test-plugin", ["multi_account_suspicion", "rapid_login_attempts"]);
    expect(securityScanRegistry.isClaimed("multi_account_suspicion")).toBe(true);
    expect(securityScanRegistry.isClaimed("rapid_login_attempts")).toBe(true);
    expect(securityScanRegistry.isClaimed("registration_burst")).toBe(false);
    securityScanRegistry.deregister("test-plugin");
  });

  it("releases claims on deregister (baseline auto-restores)", () => {
    securityScanRegistry.claimPatterns("test-plugin", ["ban_evasion_suspicion"]);
    securityScanRegistry.deregister("test-plugin");
    expect(securityScanRegistry.isClaimed("ban_evasion_suspicion")).toBe(false);
  });

  it("accumulates claims across multiple calls from one plugin", () => {
    securityScanRegistry.claimPatterns("test-plugin", ["a"]);
    securityScanRegistry.claimPatterns("test-plugin", ["b"]);
    expect(securityScanRegistry.isClaimed("a")).toBe(true);
    expect(securityScanRegistry.isClaimed("b")).toBe(true);
    securityScanRegistry.deregister("test-plugin");
  });

  it("keeps a pattern claimed while any plugin still claims it", () => {
    securityScanRegistry.claimPatterns("plugin-a", ["shared_pattern"]);
    securityScanRegistry.claimPatterns("plugin-b", ["shared_pattern"]);
    securityScanRegistry.deregister("plugin-a");
    expect(securityScanRegistry.isClaimed("shared_pattern")).toBe(true);
    securityScanRegistry.deregister("plugin-b");
    expect(securityScanRegistry.isClaimed("shared_pattern")).toBe(false);
  });

  it("isolates scan failures: one throwing scan never aborts the others", async () => {
    const ran: string[] = [];
    securityScanRegistry.register("plugin-a", async () => { throw new Error("boom"); });
    securityScanRegistry.register("plugin-a", async () => { ran.push("a2"); });
    securityScanRegistry.register("plugin-b", async () => { ran.push("b1"); });
    await securityScanRegistry.runAll();
    expect(ran).toEqual(["a2", "b1"]);
    securityScanRegistry.deregister("plugin-a");
    securityScanRegistry.deregister("plugin-b");
  });
});

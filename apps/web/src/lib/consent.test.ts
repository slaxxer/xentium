import { afterEach, describe, expect, it } from "vitest";
import {
  declareConsent, forgetConsentFor, hasConsent, listConsentDeclarations, onConsentChange, setConsentProvider,
  type ConsentCategory,
} from "./consent";

afterEach(() => setConsentProvider(null));

describe("consent", () => {
  it("allows only what is necessary until a consent plugin answers", () => {
    expect(hasConsent("necessary")).toBe(true);
    for (const c of ["preferences", "statistics", "marketing", "media"] as ConsentCategory[]) expect(hasConsent(c)).toBe(false);
  });

  it("asks the provider once one is registered, and tells listeners when it changes", () => {
    let granted = new Set<ConsentCategory>();
    const subs = new Set<() => void>();
    setConsentProvider({
      has: (c) => granted.has(c),
      subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn); }; },
      open: () => {},
    });
    let calls = 0;
    const off = onConsentChange(() => { calls++; });
    expect(hasConsent("media")).toBe(false);
    granted = new Set(["media"]);
    subs.forEach((fn) => fn());
    expect(hasConsent("media")).toBe(true);
    expect(hasConsent("marketing")).toBe(false);
    expect(calls).toBe(1);
    off();
  });

  it("declares core's own cookies, and forgets a plugin's with the plugin", () => {
    expect(listConsentDeclarations().some((d) => d.id === "core.xt_rt")).toBe(true);
    declareConsent({ id: "p.x", name: "x", kind: "cookie", category: "statistics", provider: "this", purpose: "x" }, "plug");
    expect(listConsentDeclarations().find((d) => d.id === "p.x")?.pluginId).toBe("plug");
    forgetConsentFor("plug");
    expect(listConsentDeclarations().some((d) => d.id === "p.x")).toBe(false);
  });
});

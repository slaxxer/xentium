/**
 * The sample-data gate.
 *
 * @vitest-environment jsdom
 *
 * ⚠ This file is almost entirely about REFUSING. Preview mode is a URL query param
 * anyone can type, so the risk is not that samples fail to appear in the editor — it
 * is that fabricated followers and a fabricated rank appear on a real member's
 * profile to someone who simply appended `?__layout=draft`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const user = { value: null as unknown };
vi.mock("../lib/authStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/authStore")>()),
  authStore: { get user() { return user.value; } },
}));

const { previewSample, showsSampleData } = await import("./previewSample");

// Staff = holds admin.access (what the editor itself requires), not a group name.
const staff  = { groups: [{ key: "member" }], permissions: ["admin.access"] };
const member = { groups: [{ key: "member" }], permissions: ["article.create"] };

function at(search: string) {
  Object.defineProperty(window, "location", {
    value: { search, pathname: "/u/someone" }, writable: true, configurable: true,
  });
}

beforeEach(() => { user.value = null; at(""); });
afterEach(() => vi.restoreAllMocks());

describe("who sees sample data", () => {
  it("shows it to staff inside the editor's preview", () => {
    user.value = staff; at("?__layout=draft");
    expect(showsSampleData()).toBe(true);
    expect(previewSample("SAMPLE")).toBe("SAMPLE");
  });

  /** ⚠ The attack: an ordinary member types the parameter on someone's profile. */
  it("refuses a logged-in member who types the parameter", () => {
    user.value = member; at("?__layout=draft");
    expect(showsSampleData()).toBe(false);
    expect(previewSample("SAMPLE")).toBeUndefined();
  });

  it("refuses a guest who types the parameter", () => {
    user.value = null; at("?__layout=draft");
    expect(showsSampleData()).toBe(false);
  });

  /** Staff on the real site see the truth, like everyone else. */
  it("refuses staff on a normal page", () => {
    user.value = staff; at("");
    expect(showsSampleData()).toBe(false);
  });

  /**
   * ⚠ `preview` is the THEME previewer — "show me my site with this theme", which an
   * admin uses to decide whether to keep it. Invented content has no place in a
   * decision about how the real site looks.
   */
  it("refuses the theme previewer, which is a different mode", () => {
    user.value = staff; at("?__layout=preview");
    expect(showsSampleData()).toBe(false);
  });

  /** ⚠ The permission decides, not the group's name: a renamed or custom group counts. */
  it("follows the permission, never the group name", () => {
    at("?__layout=draft");
    user.value = { groups: [{ key: "editors" }], permissions: ["admin.access"] };
    expect(showsSampleData()).toBe(true);
    user.value = { groups: [{ key: "admin" }], permissions: [] };
    expect(showsSampleData()).toBe(false);
  });
});

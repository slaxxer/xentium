import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _emitAndWait, _resetEvents, addFilter, addListener, assertAllowed, contribute, deregisterEvents,
  emit, emitGroupsChanged, plainForFilter, validate,
} from "./events.js";

afterEach(() => { _resetEvents(); vi.useRealTimers(); });

const tick = () => new Promise((r) => setImmediate(r));

describe("events", () => {
  it("calls every listener with the payload, after the caller has moved on", async () => {
    const seen: unknown[] = [];
    addListener("a", "user.registered", (p) => { seen.push(["a", p]); });
    addListener("b", "user.registered", (p) => { seen.push(["b", p]); });
    emit("user.registered", { userId: "u1", method: "password" });
    expect(seen).toEqual([]);               // not inside the caller's turn
    await tick(); await tick();
    expect(seen).toEqual([["a", { userId: "u1", method: "password" }], ["b", { userId: "u1", method: "password" }]]);
  });

  it("keeps a failing listener from stopping the others", async () => {
    const ok = vi.fn();
    addListener("bad", "article.published", () => { throw new Error("boom"); });
    addListener("good", "article.published", ok);
    await _emitAndWait("article.published", { articleId: "a", authorId: "u" });
    expect(ok).toHaveBeenCalledOnce();
  });

  it("gives up on a listener that runs past its limit", async () => {
    vi.useFakeTimers();
    const ok = vi.fn();
    addListener("slow", "user.loggedIn", () => new Promise(() => {}));
    addListener("fast", "user.loggedIn", ok);
    const done = _emitAndWait("user.loggedIn", { userId: "u", method: "password" });
    await vi.advanceTimersByTimeAsync(5_001);
    await done;
    expect(ok).toHaveBeenCalledOnce();
  });

  it("drops a plugin's listeners and filters on disable", async () => {
    const fn = vi.fn();
    addListener("p", "user.banned", fn);
    addFilter("p", "comment.validate", () => ({ refuse: "p:no" }));
    deregisterEvents("p");
    await _emitAndWait("user.banned", { userId: "u", until: null, byUserId: null });
    expect(fn).not.toHaveBeenCalled();
    expect(await validate("comment.validate", { userId: "u", articleId: "a", body: "x" })).toBeNull();
  });

  it("refuses names that are not events, and filters core does not offer", () => {
    expect(() => addListener("p", "Not An Event", () => {})).toThrow();
    expect(() => addFilter("p", "article.rewrite" as never, (() => {}) as never)).toThrow();
  });

  it("announces group changes only when something changed", async () => {
    const fn = vi.fn();
    addListener("p", "user.groupsChanged", fn);
    emitGroupsChanged("u", ["g1", "g2"], ["g2", "g3"]);
    emitGroupsChanged("u", ["g1"], ["g1"]);
    await tick(); await tick();
    expect(fn).toHaveBeenCalledOnce();
    expect(fn.mock.calls[0]![0]).toEqual({ userId: "u", added: ["g3"], removed: ["g1"] });
  });
});

describe("filters", () => {
  const input = { email: "a@b.test", username: "admin2", method: "password" as const };

  it("lets an action through when nobody refuses", async () => {
    addFilter("p", "registration.validate", () => undefined);
    expect(await validate("registration.validate", input)).toBeNull();
    await expect(assertAllowed("registration.validate", input)).resolves.toBeUndefined();
  });

  it("stops at the first refusal and says whose it is", async () => {
    const later = vi.fn();
    addFilter("names", "registration.validate", (i) => (i.username.startsWith("admin") ? { refuse: "names:reserved", params: { name: i.username } } : undefined));
    addFilter("other", "registration.validate", later);
    expect(await validate("registration.validate", input)).toEqual({ refuse: "names:reserved", params: { name: "admin2" }, pluginId: "names" });
    expect(later).not.toHaveBeenCalled();
    await expect(assertAllowed("registration.validate", input)).rejects.toMatchObject({
      code: "XEC-PLUGIN-4220", httpStatus: 422, details: { key: "names:reserved", pluginId: "names" },
    });
  });

  it("treats a filter that throws as no change", async () => {
    addFilter("broken", "article.validate", () => { throw new Error("db down"); });
    expect(await validate("article.validate", { userId: "u", articleId: null, title: "t", body: "b", publish: false })).toBeNull();
  });

  it("collects contributions under each plugin's id, skipping empty and failing ones", async () => {
    addFilter("shop", "profile.extra", () => ({ orders: 3 }));
    addFilter("quiet", "profile.extra", () => undefined);
    addFilter("broken", "profile.extra", () => { throw new Error("x"); });
    expect(await contribute("profile.extra", { userId: "u", viewerId: null })).toEqual({ shop: { orders: 3 } });
  });

  it("hands filters plain text, not markup", () => {
    expect(plainForFilter("<p>Hello <b>you</b> &amp; me</p><p>Bye</p>")).toBe("Hello you & me\nBye");
  });
});

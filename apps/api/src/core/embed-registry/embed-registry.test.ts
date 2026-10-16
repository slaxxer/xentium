import { describe, expect, it, vi } from "vitest";
import { embedRegistry } from "./embed-registry.js";
import { contentRegistry } from "../content-registry/content-registry.js";

const host = { kind: "forum.post", id: "p1", authorId: "u1" };

describe("embedRegistry", () => {
  it("hands each type its own ids, and an empty list when none are left", async () => {
    const poll = { type: "poll", sync: vi.fn(async () => []), remove: vi.fn(async () => {}) };
    const quiz = { type: "quiz", sync: vi.fn(async () => []), remove: vi.fn(async () => {}) };
    embedRegistry.register("test-polls", poll);
    embedRegistry.register("test-quiz", quiz);
    await embedRegistry.sync(host, '<div class="xt-embed" data-xt-embed="poll" data-id="a"></div>');
    expect(poll.sync).toHaveBeenCalledWith(host, ["a"]);
    expect(quiz.sync).toHaveBeenCalledWith(host, []);
    embedRegistry.deregister("test-polls");
    embedRegistry.deregister("test-quiz");
  });

  it("never fails the save when a plugin throws", async () => {
    embedRegistry.register("test-broken", { type: "poll", sync: async () => { throw new Error("x"); }, remove: async () => { throw new Error("y"); } });
    await expect(embedRegistry.sync(host, "")).resolves.toBeUndefined();
    await expect(embedRegistry.remove(host)).resolves.toBeUndefined();
    embedRegistry.deregister("test-broken");
  });

  it("refuses a type another plugin owns", () => {
    embedRegistry.register("test-a", { type: "poll", sync: async () => [], remove: async () => {} });
    expect(() => embedRegistry.register("test-b", { type: "poll", sync: async () => [], remove: async () => {} })).toThrow();
    embedRegistry.deregister("test-a");
  });
});

describe("contentRegistry", () => {
  it("fails closed: unknown kind, error, or not a strict true", async () => {
    expect(await contentRegistry.canView("nope.kind", "1", "u1")).toBe(false);
    contentRegistry.register("test-forum", { kind: "test.post", canView: async () => { throw new Error("db"); } });
    expect(await contentRegistry.canView("test.post", "1", "u1")).toBe(false);
    contentRegistry.deregister("test-forum");
    contentRegistry.register("test-forum", { kind: "test.post", canView: async (id) => id === "ok" });
    expect(await contentRegistry.canView("test.post", "ok", null)).toBe(true);
    expect(await contentRegistry.canView("test.post", "no", null)).toBe(false);
    contentRegistry.deregister("test-forum");
    expect(await contentRegistry.canView("test.post", "ok", null)).toBe(false);
  });

  it("refuses a kind someone else owns, and a malformed kind", () => {
    contentRegistry.register("test-a", { kind: "test.thing", canView: async () => true });
    expect(() => contentRegistry.register("test-b", { kind: "test.thing", canView: async () => true })).toThrow();
    expect(() => contentRegistry.register("test-b", { kind: "Bad Kind", canView: async () => true })).toThrow();
    contentRegistry.deregister("test-a");
  });
});

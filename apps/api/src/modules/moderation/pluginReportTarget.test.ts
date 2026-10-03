/**
 * Reported plugin content: core asks the plugin (`ctx.registerReportTarget`) what an
 * item is, and only offers Remove when the plugin can remove it. Core never reads a
 * plugin's tables, so before this a forum post's report carried only its reason.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../infrastructure/db.js", () => ({ prisma: {} }));

const { reportTargetRegistry } = await import("../../core/report-target-registry/report-target-registry.js");
const { describeTarget, canRemoveTarget } = await import("./reportTarget.js");

afterEach(() => reportTargetRegistry.deregister("forum"));

describe("plugin report targets", () => {
  it("describes plugin content through the plugin's handler", async () => {
    reportTargetRegistry.register("forum", {
      kind: "post",
      describe: async (id) => ({ authorId: "u1", snapshot: `<p>Post ${id}</p>`, where: "A thread", href: "/forum/thread/a?page=2" }),
    });
    expect(await describeTarget("plugin-content", "forum:post:42")).toEqual({
      authorId: "u1", snapshot: "Post 42", where: "A thread", href: "/forum/thread/a?page=2",
    });
  });

  it("keeps only site-relative links", async () => {
    reportTargetRegistry.register("forum", {
      kind: "post",
      describe: async () => ({ authorId: null, snapshot: null, where: null, href: "//evil.example/x" }),
    });
    expect((await describeTarget("plugin-content", "forum:post:1")).href).toBeNull();
  });

  it("resolves to nothing for an unknown plugin, kind or a malformed id", async () => {
    const none = { authorId: null, snapshot: null, where: null, href: null };
    expect(await describeTarget("plugin-content", "nobody:post:1")).toEqual(none);
    expect(await describeTarget("plugin-content", "forum")).toEqual(none);
  });

  it("offers Remove only when the plugin can remove", () => {
    reportTargetRegistry.register("forum", { kind: "post", describe: async () => null, remove: async () => {} });
    reportTargetRegistry.register("forum", { kind: "tag", describe: async () => null });
    expect(canRemoveTarget("plugin-content", "forum:post:1")).toBe(true);
    expect(canRemoveTarget("plugin-content", "forum:tag:1")).toBe(false);
    expect(canRemoveTarget("user", "u1")).toBe(false);
    expect(canRemoveTarget("article_comment", "c1")).toBe(true);
  });

  it("forgets a plugin's targets when it is disabled", async () => {
    reportTargetRegistry.register("forum", { kind: "post", describe: async () => ({ authorId: "u1", snapshot: null, where: "x", href: null }) });
    reportTargetRegistry.deregister("forum");
    expect((await describeTarget("plugin-content", "forum:post:1")).authorId).toBeNull();
  });
});

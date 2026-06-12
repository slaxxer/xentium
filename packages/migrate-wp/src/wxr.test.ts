import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseWxr } from "./wxr.js";

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/sample.wxr.xml");

describe("WXR extractor", () => {
  const parsed = parseWxr(FIXTURE);

  it("identifies the source", () => {
    expect(parsed.sourceInfo).toBe("WordPress (WXR 1.2)");
  });

  it("extracts valid users and skips broken ones", () => {
    expect(parsed.users.map((u) => u.username)).toEqual(["alice", "bob"]);
    expect(parsed.users[0]).toMatchObject({
      sourceId: "1",
      email: "alice@fixture.test",
      displayName: "Alice Müller",
    });
    // author with no email → skipped with a reason
    expect(parsed.skipped.some((s) => s.entity === "user" && s.sourceId === "3")).toBe(true);
    // WXR has no password hashes — none must be claimed
    expect(parsed.users.every((u) => u.passwordHash === undefined)).toBe(true);
  });

  it("extracts the category tree with parents", () => {
    const releases = parsed.categories.find((c) => c.sourceId === "releases")!;
    expect(releases.parentSourceId).toBe("news");
    expect(parsed.categories.find((c) => c.sourceId === "guides")!.name).toBe("Guides & How-tos");
  });

  it("extracts posts with author, category, tags and status mapping", () => {
    expect(parsed.articles).toHaveLength(3); // 100 rich, 101 wpautop, 102 draft
    const rich = parsed.articles.find((a) => a.sourceId === "100")!;
    expect(rich.title).toContain("Hello World 🎉");
    expect(rich.authorSourceId).toBe("1");
    expect(rich.categorySourceId).toBe("releases");
    expect(rich.tags).toEqual(["Announcement", "v1"]);
    expect(rich.status).toBe("published");
    expect(rich.publishedAt?.toISOString()).toBe("2024-03-01T10:00:00.000Z");

    const draft = parsed.articles.find((a) => a.sourceId === "102")!;
    expect(draft.status).toBe("draft");
    expect(draft.publishedAt).toBeUndefined(); // 0000-00-00 guarded
  });

  it("skips pages, attachments, trashed posts and unknown authors with reasons", () => {
    expect(parsed.otherTypes).toEqual({ page: 1, attachment: 1 });
    expect(parsed.skipped.some((s) => s.entity === "article" && s.sourceId === "106")).toBe(true); // trash
    expect(parsed.skipped.some((s) => s.entity === "article" && s.sourceId === "103" && /ghost/.test(s.reason))).toBe(true);
  });

  it("extracts approved member comments, skips guests and spam", () => {
    expect(parsed.comments.map((c) => c.sourceId)).toEqual(["500", "501", "502"]);
    const reply = parsed.comments.find((c) => c.sourceId === "501")!;
    expect(reply.parentSourceId).toBe("500");
    expect(reply.authorSourceId).toBe("1");
    expect(parsed.guestComments).toBe(1);
    expect(parsed.unapprovedComments).toBe(1);
    expect(parsed.skipped.some((s) => s.entity === "comment" && s.sourceId === "503")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { glowShadow, isSensitive, powerOf, reorder, type Group } from "./groupModel";

const group = (id: string): Group => ({
  id, name: id, key: id, icon: null, isSystem: false, displayOrder: 0, showInTeam: false,
  _count: { users: 0 }, permissions: [], progression: null,
});

describe("power", () => {
  it("is full control with the admin panel, whatever else is held", () => {
    expect(powerOf(["admin.access"])).toMatchObject({ level: "full", segments: 4, sensitive: 1, total: 1 });
  });

  it("climbs with sensitive keys", () => {
    expect(powerOf(["article.create", "message.send"]).level).toBe("standard");
    expect(powerOf(["user.ban", "article.create"]).level).toBe("trusted");
    expect(powerOf(["user.ban", "user.manage", "badge.manage", "article.delete.any"]).level).toBe("elevated");
  });

  it("judges a plugin's keys by the same rule", () => {
    expect(isSensitive("forum.settings")).toBe(true);
    expect(isSensitive("shoutbox.manage")).toBe(true);
    expect(isSensitive("forum.thread.create")).toBe(false);
  });
});

describe("reorder", () => {
  const list = ["a", "b", "c", "d"].map(group);

  it("moves a group to another's place and numbers the result densely", () => {
    expect(reorder(list, "d", "b")).toEqual([
      { id: "a", displayOrder: 1 }, { id: "d", displayOrder: 2 },
      { id: "b", displayOrder: 3 }, { id: "c", displayOrder: 4 },
    ]);
  });

  it("does nothing for a drop onto itself or an unknown group", () => {
    expect(reorder(list, "b", "b")).toBeNull();
    expect(reorder(list, "b", "zz")).toBeNull();
  });
});

describe("glow", () => {
  it("draws nothing when off, and falls back to the badge colour", () => {
    expect(glowShadow({ badgeColor: "#f00", badgeLabel: null, badgeTextShadow: false }, "#f00")).toBeUndefined();
    expect(glowShadow({ badgeColor: "#f00", badgeLabel: null, badgeTextShadow: true, badgeShadowX: 2, badgeShadowY: 3, badgeShadowBlur: 9 }, "#f00"))
      .toBe("2px 3px 9px #f00");
  });
});

describe("editableProgression", () => {
  it("drops what the server stamps, so a save cannot trigger another", async () => {
    const { editableProgression } = await import("./groupModel");
    const a = editableProgression({ groupId: "g", updatedAt: "1", isProgressionGroup: true, minArticles: 3 });
    const b = editableProgression({ groupId: "g", updatedAt: "2", isProgressionGroup: true, minArticles: 3 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a).not.toHaveProperty("updatedAt");
    expect(a.canUploadCover).toBe(true); // absent = allowed, the server's default
  });
});

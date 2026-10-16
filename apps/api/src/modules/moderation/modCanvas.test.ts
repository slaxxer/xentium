/**
 * ModCanvas: the grouped report inspector, acting on a group, claims and templates.
 *
 * Pins what the redesign relies on and what was missing before it:
 *   - a report on core content records its author and a snapshot (nothing filled
 *     those, so the canvas could not warn anyone over an article comment);
 *   - reports about one thing are one row, and acting closes all of them;
 *   - a silent warning sends no notification;
 *   - Undo reopens what a dismissal closed.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { permissionCache } from "../permissions/permission.cache.js";
import { moderationService } from "./moderation.service.js";
import { modCanvasService } from "./modCanvas.service.js";
import { plainText } from "./reportTarget.js";

const P = "mcprobe";
let ids: Record<"author" | "r1" | "r2" | "mod" | "owner", string>;
let comment: string;
let groupId: string;

async function user(name: string) {
  return (await prisma.user.create({
    data: { username: `${P}_${name}`, email: `${P}_${name}@example.test`, passwordHash: "x" },
  })).id;
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { username: { startsWith: `${P}_` } }, select: { id: true } });
  const uids = users.map((u) => u.id);
  await prisma.moderationReport.deleteMany({ where: { reporterId: { in: uids } } });
  await prisma.moderationWarning.deleteMany({ where: { userId: { in: uids } } });
  await prisma.moderationBan.deleteMany({ where: { userId: { in: uids } } });
  await prisma.moderationLog.deleteMany({ where: { actorId: { in: uids } } });
  await prisma.notification.deleteMany({ where: { userId: { in: uids } } }).catch(() => {});
  await prisma.profileComment.deleteMany({ where: { authorId: { in: uids } } });
  await prisma.moderationTemplate.deleteMany({ where: { name: { startsWith: `${P} ` } } });
  await prisma.userGroup.deleteMany({ where: { userId: { in: uids } } });
  await prisma.user.deleteMany({ where: { id: { in: uids } } });
  if (groupId) await prisma.group.deleteMany({ where: { id: groupId } });
}

beforeEach(async () => {
  assertDisposableDatabase();
  await cleanup();
  ids = { author: await user("author"), r1: await user("r1"), r2: await user("r2"), mod: await user("mod"), owner: await user("owner") };
  // A group holding the moderation permissions the action endpoint checks. Upserted:
  // on a fresh database (CI) nothing has registered the permission rows yet.
  const perms = await Promise.all(
    ["moderation.warn.manage", "moderation.ban.manage", "moderation.report.manage"].map((key) =>
      prisma.permission.upsert({ where: { key }, update: {}, create: { key, label: key } })),
  );
  groupId = (await prisma.group.create({
    data: { key: `${P}_mods`, name: "Probe mods", permissions: { create: perms.map((p) => ({ permissionId: p.id })) } },
  })).id;
  await prisma.userGroup.create({ data: { userId: ids.mod, groupId } });
  await permissionCache.invalidate(ids.mod);
  comment = (await prisma.profileComment.create({
    data: { profileUserId: ids.owner, authorId: ids.author, body: "<p>You are <b>awful</b> &amp; wrong</p>" },
  })).id;
});

afterEach(cleanup);

const file = (reporterId: string, reason = "harassment") =>
  moderationService.fileReport({ targetType: "profile_comment", targetId: comment, reporterId, reason });

describe("filing", () => {
  it("records the author and a plain-text snapshot", async () => {
    const r = await file(ids.r1);
    expect(r.targetUserId).toBe(ids.author);
    expect(r.contentSnapshot).toBe("You are awful & wrong");
  });
});

describe("the inspector", () => {
  it("groups reports about one thing, with its author and where it is", async () => {
    await file(ids.r1); await file(ids.r2, "rude");
    const { data } = await modCanvasService.inspector();
    const g = data.find((x) => x.targetId === comment)!;
    expect(g.reports).toHaveLength(2);
    expect(g.where).toBe(`${P}_owner's profile`);
    expect(g.author?.id).toBe(ids.author);
    expect(g.author?.activeWarnings).toBe(0);
  });
});

describe("acting on a group", () => {
  it("warns the author, closes every report, counts the template, and can stay silent", async () => {
    const a = await file(ids.r1); const b = await file(ids.r2);
    const tpl = await modCanvasService.createTemplate(ids.mod, { mode: "warn", name: `${P} warn`, text: "Hi {user}" });

    const res = await modCanvasService.act(ids.mod, {
      reportIds: [a.id, b.id], mode: "warn", templateId: tpl.id, message: "Hi there, please stop.", notify: false,
    });
    expect(res).toEqual({ status: "resolved", count: 2 });
    expect(await prisma.moderationWarning.count({ where: { userId: ids.author } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: ids.author, type: "moderation.warning_issued" } })).toBe(0);
    expect(await prisma.moderationReport.count({ where: { id: { in: [a.id, b.id] }, status: "resolved" } })).toBe(2);
    expect((await prisma.moderationTemplate.findUnique({ where: { id: tpl.id } }))?.useCount).toBe(1);
  });

  it("removes the content", async () => {
    const a = await file(ids.r1);
    await modCanvasService.act(ids.mod, { reportIds: [a.id], mode: "delete", message: "Removed for abuse.", notify: true });
    expect((await prisma.profileComment.findUnique({ where: { id: comment } }))?.deletedAt).not.toBeNull();
  });

  it("dismisses, and Undo reopens", async () => {
    const a = await file(ids.r1);
    await modCanvasService.act(ids.mod, { reportIds: [a.id], mode: "dismiss", message: "No rule broken.", notify: true });
    expect((await prisma.moderationReport.findUnique({ where: { id: a.id } }))?.status).toBe("dismissed");
    expect(await prisma.notification.count({ where: { userId: ids.r1, type: "moderation.report_reviewed" } })).toBe(1);

    await modCanvasService.setStatus(ids.mod, [a.id], "pending");
    const back = await prisma.moderationReport.findUnique({ where: { id: a.id } });
    expect(back?.status).toBe("pending");
    expect(back?.resolvedAt).toBeNull();
  });

  it("refuses one action across different things", async () => {
    const a = await file(ids.r1);
    const b = await moderationService.fileReport({ targetType: "user", targetId: ids.author, reporterId: ids.r2, reason: "spam" });
    await expect(modCanvasService.act(ids.mod, { reportIds: [a.id, b.id], mode: "dismiss", message: "x y z", notify: false }))
      .rejects.toThrow(/one thing/);
  });

  it("checks the permission the mode needs", async () => {
    const a = await file(ids.r1);
    await expect(modCanvasService.act(ids.r2, { reportIds: [a.id], mode: "ban", message: "Banned.", notify: false, duration: "7d" }))
      .rejects.toThrow(/permission/);
  });
});

describe("claims and templates", () => {
  it("claims a group and releases it", async () => {
    const a = await file(ids.r1);
    expect((await modCanvasService.claim(ids.mod, [a.id], true)).claimedBy?.id).toBe(ids.mod);
    expect((await modCanvasService.inspector()).data.find((x) => x.targetId === comment)?.claimedBy?.id).toBe(ids.mod);
    await modCanvasService.claim(ids.mod, [a.id], false);
    expect((await prisma.moderationReport.findUnique({ where: { id: a.id } }))?.assignedTo).toBeNull();
  });

  it("keeps a default length only on bans, and soft-deletes", async () => {
    const t = await modCanvasService.createTemplate(ids.mod, { mode: "ban", name: `${P} ban`, text: "Banned for {duration}" });
    expect(t.defaultDuration).toBe("7d");
    const moved = await modCanvasService.updateTemplate(ids.mod, t.id, { mode: "warn" });
    expect(moved.defaultDuration).toBeNull();
    await modCanvasService.deleteTemplate(t.id);
    expect((await modCanvasService.listTemplates()).some((x) => x.id === t.id)).toBe(false);
  });
});

describe("restoring the default texts", () => {
  it("fills an empty set, adds back a deleted default, and leaves an edited one alone", async () => {
    // Self-contained: the test database may have been truncated, so the seed rows cannot be assumed.
    const before = await prisma.moderationTemplate.findMany();
    await prisma.moderationTemplate.deleteMany({});
    try {
      expect((await modCanvasService.restoreDefaults(ids.mod)).restored).toBe(13);

      const hate = (await prisma.moderationTemplate.findFirst({ where: { mode: "ban", name: "Hate speech" } }))!;
      const harass = (await prisma.moderationTemplate.findFirst({ where: { mode: "warn", name: "Harassment" } }))!;
      await modCanvasService.deleteTemplate(hate.id);
      await modCanvasService.updateTemplate(ids.mod, harass.id, { text: "Our own wording" });

      expect((await modCanvasService.restoreDefaults(ids.mod)).restored).toBe(1);
      const list = await modCanvasService.listTemplates();
      expect(list.find((t) => t.name === "Hate speech")?.isDefault).toBe(true);
      expect(list.find((t) => t.name === "Harassment")?.text).toBe("Our own wording");
      expect((await modCanvasService.restoreDefaults(ids.mod)).restored).toBe(0);
    } finally {
      await prisma.moderationTemplate.deleteMany({});
      if (before.length) await prisma.moderationTemplate.createMany({ data: before });
    }
  });
});

describe("plainText", () => {
  it("drops tags and decodes the common entities", () => {
    expect(plainText("<p>a&nbsp;<i>b</i></p><p>c &lt;3</p>")).toBe("a b c <3");
  });
});

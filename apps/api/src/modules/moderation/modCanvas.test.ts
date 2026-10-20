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
import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { permissionCache } from "../permissions/permission.cache.js";
import { moderationService } from "./moderation.service.js";
import { modCanvasService, templateWords, fromTemplate } from "./modCanvas.service.js";
import { bustSettingsCache } from "../../shared/utils/settings.js";
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
    const tpl = await modCanvasService.createTemplate(ids.mod, { mode: "warn", name: `${P} warn`, text: "Hi {user}, your {type} on {where}." });

    const res = await modCanvasService.act(ids.mod, {
      reportIds: [a.id, b.id], mode: "warn", templateId: tpl.id, message: "You are an idiot.", notify: false,
    });
    expect(res).toEqual({ status: "resolved", count: 2 });
    // The server fills the template in; whatever text the request carried is ignored.
    const warnings = await prisma.moderationWarning.findMany({ where: { userId: ids.author } });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.reason).toBe(`Hi ${P}_author, your profile comment on ${P}_owner's profile.`);
    expect(await prisma.notification.count({ where: { userId: ids.author, type: "moderation.warning_issued" } })).toBe(0);
    expect(await prisma.moderationReport.count({ where: { id: { in: [a.id, b.id] }, status: "resolved" } })).toBe(2);
    expect((await prisma.moderationTemplate.findUnique({ where: { id: tpl.id } }))?.useCount).toBe(1);
  });

  it("will not warn without a warn template", async () => {
    const a = await file(ids.r1);
    await expect(modCanvasService.act(ids.mod, { reportIds: [a.id], mode: "warn", message: "Written by hand.", notify: false }))
      .rejects.toMatchObject({ code: "XEC-MOD-4101" });
    const ban = await modCanvasService.createTemplate(ids.mod, { mode: "ban", name: `${P} ban`, text: "Banned." });
    await expect(modCanvasService.act(ids.mod, { reportIds: [a.id], mode: "warn", templateId: ban.id, notify: false }))
      .rejects.toMatchObject({ code: "XEC-MOD-4101" });
    expect(await prisma.moderationWarning.count({ where: { userId: ids.author } })).toBe(0);
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

describe("the admin's order", () => {
  it("lists one action's templates in the order given, and adds a new one at the end", async () => {
    const mk = (name: string) => modCanvasService.createTemplate(ids.mod, { mode: "dismiss", name: `${P} ${name}`, text: "Noted." });
    const a = await mk("a"), b = await mk("b"), c = await mk("c");
    const mine = async () => (await modCanvasService.listTemplates()).filter((x) => x.name.startsWith(P) && x.mode === "dismiss").map((x) => x.name);

    await modCanvasService.reorderTemplates([c.id, a.id, b.id]);
    expect(await mine()).toEqual([`${P} c`, `${P} a`, `${P} b`]);

    await mk("d");   // ordered list → goes last, not first
    expect(await mine()).toEqual([`${P} c`, `${P} a`, `${P} b`, `${P} d`]);
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

describe("default texts in the site's language", () => {
  async function withSiteLocale(locale: string, fn: () => Promise<void>) {
    const before = await prisma.moderationTemplate.findMany();
    const prev = await prisma.setting.findUnique({ where: { key: "site.locale" } });
    await prisma.moderationTemplate.deleteMany({});
    await prisma.setting.upsert({ where: { key: "site.locale" }, update: { value: locale }, create: { key: "site.locale", value: locale } });
    bustSettingsCache("site.locale");
    try {
      await modCanvasService.restoreDefaults(ids.mod);
      await fn();
    } finally {
      await prisma.moderationTemplate.deleteMany({});
      if (before.length) await prisma.moderationTemplate.createMany({ data: before });
      if (prev) await prisma.setting.update({ where: { key: "site.locale" }, data: { value: prev.value as Prisma.InputJsonValue } });
      else await prisma.setting.deleteMany({ where: { key: "site.locale" } });
      bustSettingsCache("site.locale");
    }
  }

  it("shows an untouched default in German on a German site, and stores it in English", async () => {
    await withSiteLocale("de", async () => {
      const list = await modCanvasService.listTemplates();
      const harass = list.find((t) => t.mode === "warn" && t.name === "Belästigung")!;
      expect(harass.text).toContain("{user}");
      expect(harass.isDefault).toBe(true);
      const row = await prisma.moderationTemplate.findUniqueOrThrow({ where: { id: harass.id } });
      expect(row.name).toBe("Harassment");
      expect(row.defaultKey).toBe("warn.harassment");
    });
  });

  it("keeps a default a default when saved unchanged, and an edit as written", async () => {
    await withSiteLocale("de", async () => {
      const list = await modCanvasService.listTemplates();
      const harass = list.find((t) => t.name === "Belästigung")!;
      await modCanvasService.updateTemplate(ids.mod, harass.id, { name: harass.name, text: harass.text });
      expect((await prisma.moderationTemplate.findUniqueOrThrow({ where: { id: harass.id } })).name).toBe("Harassment");

      await modCanvasService.updateTemplate(ids.mod, harass.id, { text: "Unser eigener Text" });
      const row = await prisma.moderationTemplate.findUniqueOrThrow({ where: { id: harass.id } });
      expect(row.text).toBe("Unser eigener Text");
      expect((await modCanvasService.listTemplates()).find((t) => t.id === harass.id)?.isDefault).toBe(true);
    });
  });

  it("fills {type} and {duration} in the site's language", async () => {
    await withSiteLocale("fr", async () => {
      const words = await templateWords();
      expect(words.locale).toBe("fr");
      expect(words.type.comment).toBe("commentaire");
      expect(words.duration["7d"]).toBe("7 jours");
    });
  });
});

describe("plainText", () => {
  it("drops tags and decodes the common entities", () => {
    expect(plainText("<p>a&nbsp;<i>b</i></p><p>c &lt;3</p>")).toBe("a b c <3");
  });
});

describe("from a template", () => {
  const warnOf = (templateId: string | null, userId = ids.author, length?: string) => fromTemplate({
    actorId: ids.mod, mode: "warn", templateId, userId, target: { type: "profile_comment", id: comment }, length,
  });

  it("fills a warn template from the content, and refuses content by someone else", async () => {
    const tpl = await modCanvasService.createTemplate(ids.mod, { mode: "warn", name: `${P} warn`, text: "{user}: {type} on {where}" });
    expect((await warnOf(tpl.id)).text).toBe(`${P}_author: profile comment on ${P}_owner's profile`);
    await expect(warnOf(tpl.id, ids.r1)).rejects.toMatchObject({ code: "XEC-MOD-4102" });
    await expect(warnOf(null)).rejects.toMatchObject({ code: "XEC-MOD-4101" });
  });

  it("takes the timing from the template; another one needs the override permission", async () => {
    const tpl = await modCanvasService.createTemplate(ids.mod, { mode: "warn", name: `${P} warn`, text: "Hi {user}", warnExpiry: "30d" });
    expect((await warnOf(tpl.id)).expiry).toBe("30d");
    expect((await warnOf(tpl.id, ids.author, "30d")).expiry).toBe("30d");            // its own length: fine
    await expect(warnOf(tpl.id, ids.author, "never")).rejects.toMatchObject({ httpStatus: 403 });

    const ban = await modCanvasService.createTemplate(ids.mod, { mode: "ban", name: `${P} ban`, text: "Banned for {duration}.", defaultDuration: "24h" });
    const banOf = (length?: string) => fromTemplate({ actorId: ids.mod, mode: "ban", templateId: ban.id, userId: ids.author, length });
    expect((await banOf()).length).toBe("24h");
    await expect(banOf("perm")).rejects.toMatchObject({ httpStatus: 403 });

    // A team lead holds both overrides.
    const keys = ["moderation.warn.expiry.override", "moderation.ban.length.override"];
    const perms = await Promise.all(keys.map((key) => prisma.permission.upsert({ where: { key }, update: {}, create: { key, label: key } })));
    await prisma.groupPermission.createMany({ data: perms.map((p) => ({ groupId, permissionId: p.id })) });
    await permissionCache.invalidate(ids.mod);
    expect((await warnOf(tpl.id, ids.author, "never")).expiry).toBe("never");
    expect((await banOf("perm")).length).toBe("perm");
  });

  it("a ban template that names the content needs it; one that does not, does not", async () => {
    const named = await modCanvasService.createTemplate(ids.mod, { mode: "ban", name: `${P} ban a`, text: "Your {type} on {where}." });
    await expect(fromTemplate({ actorId: ids.mod, mode: "ban", templateId: named.id, userId: ids.author }))
      .rejects.toMatchObject({ code: "XEC-MOD-4103" });
    const plain = await modCanvasService.createTemplate(ids.mod, { mode: "ban", name: `${P} ban b`, text: "Ban evasion, {user}." });
    expect((await fromTemplate({ actorId: ids.mod, mode: "ban", templateId: plain.id, userId: ids.author })).text)
      .toBe(`Ban evasion, ${P}_author.`);
  });

  it("a warning from a template counts for the template's length", async () => {
    const a = await file(ids.r1);
    const tpl = await modCanvasService.createTemplate(ids.mod, { mode: "warn", name: `${P} warn`, text: "Hi {user}", warnExpiry: "7d" });
    await modCanvasService.act(ids.mod, { reportIds: [a.id], mode: "warn", templateId: tpl.id, notify: false });
    const w = await prisma.moderationWarning.findFirstOrThrow({ where: { userId: ids.author } });
    const days = (w.expiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });
});

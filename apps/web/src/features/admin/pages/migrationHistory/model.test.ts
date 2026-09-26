import { describe, expect, it } from "vitest";
import {
  STALE_AFTER_MS, analyseCore, buildLog, effectiveStatus, entityKey, formatDuration,
  groupByDay, groupIssues, matchesQuery, packageOf, toneOf, type MigrationRun,
} from "./model";

const run = (over: Partial<MigrationRun> = {}): MigrationRun => ({
  id: "r", adapter: "core", adapterVer: null, sourceInfo: null, status: "completed",
  command: "migrate deploy", durationMs: 1700, output: null, startedAt: "2026-09-21T16:08:12Z",
  completedAt: null, summary: null, errors: null, progress: null, reportPath: null,
  createdAt: "2026-09-21T16:08:12Z", ...over,
});

describe("effectiveStatus", () => {
  const now = Date.parse("2026-09-26T12:00:00Z");
  const beat = (msAgo: number) => ({ at: new Date(now - msAgo).toISOString(), current: null, entities: {} });

  it("keeps a running import with a fresh heartbeat running", () => {
    expect(effectiveStatus(run({ status: "running", progress: beat(4_000) }), now)).toBe("running");
  });

  it("calls a running import whose heartbeat stopped stalled, instead of spinning forever", () => {
    expect(effectiveStatus(run({ status: "running", progress: beat(STALE_AFTER_MS + 1) }), now)).toBe("stalled");
    expect(effectiveStatus(run({ status: "running", progress: null }), now)).toBe("stalled");
  });

  it("trusts a stored status — never guesses from the output", () => {
    // A deploy that applied the error-log migrations says "error" all over its log.
    const output = "Applying migration `20260723000000_error_shape`\nAll migrations have been successfully applied.";
    expect(effectiveStatus(run({ output }), now)).toBe("completed");
  });
});

describe("durationOf", () => {
  it("measures a dead run up to its last heartbeat", async () => {
    const { durationOf } = await import("./model");
    const r = run({ status: "running", durationMs: null, startedAt: "2026-09-26T12:00:00Z",
      progress: { at: "2026-09-26T12:02:30Z", current: null, entities: {} } });
    expect(durationOf(r, "stalled", Date.parse("2026-09-26T13:00:00Z"))).toBe(150_000);
  });
});

describe("analyseCore", () => {
  it("finds the failed migration and the database's own error line", () => {
    const out = [
      "61 migrations found in prisma/migrations", "",
      "Applying migration `20260910120000_profile_views`",
      "Applying migration `20260910140000_profile_cover`",
      "Error: P3018", "", "Migration name: 20260910140000_profile_cover", "",
      "Database error:",
      'ERROR: column "cover_url" of relation "xcf_users" already exists',
    ].join("\n");
    expect(analyseCore(out)).toEqual({
      found: 61, applied: 2, failedName: "20260910140000_profile_cover", errorLine: 10,
      errorText: 'column "cover_url" of relation "xcf_users" already exists', nothingToApply: false,
    });
  });

  it("recognises a deploy with nothing to do", () => {
    const a = analyseCore("63 migrations found in prisma/migrations\n\nNo pending migrations to apply.");
    expect(a).toMatchObject({ found: 63, applied: 0, failedName: null, nothingToApply: true });
  });
});

describe("naming", () => {
  it("gives a count and an issue about the same entity the same key", () => {
    expect(entityKey("forumNodes")).toBe("forumNodes");
    expect(entityKey("forum_node")).toBe("forumNodes");
    expect(entityKey("post_like")).toBe("postLikes");
    expect(entityKey("post likes")).toBe("postLikes");
    expect(entityKey("user")).toBe("users");
  });

  it("reads the adapter package from the stored command, or falls back", () => {
    expect(packageOf(run({ adapter: "wordpress", command: 'pnpm --filter @xentium/migrate-wp migrate -- --file x.xml' })))
      .toBe("@xentium/migrate-wp");
    expect(packageOf(run({ adapter: "phpbb", command: null }))).toBe("@xentium/migrate-phpbb");
  });

  it("formats durations the way the list shows them", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(850)).toBe("850ms");
    expect(formatDuration(1700)).toBe("1.7s");
    expect(formatDuration(702_000)).toBe("11m 42s");
  });
});

describe("the list", () => {
  it("searches the output too", () => {
    expect(matchesQuery(run({ output: "Applying migration `x_profile_cover`" }), "profile_cover")).toBe(true);
    expect(matchesQuery(run({ output: "nothing" }), "profile_cover")).toBe(false);
  });

  it("groups by calendar day, newest first", () => {
    const days = ["2026-09-21T16:00:00", "2026-09-21T09:00:00", "2026-09-19T14:00:00"].map((d) => new Date(d));
    expect(groupByDay(days, (d) => d).map((g) => g.items.length)).toEqual([2, 1]);
  });

  it("groups issues by entity, whatever the loader called it", () => {
    const groups = groupIssues([
      { entity: "post", sourceId: "1", reason: "Body too long" },
      { entity: "posts", sourceId: "2", reason: "Body too long" },
      { entity: "user", sourceId: "9", reason: "Email address invalid" },
    ]);
    // In load order: users are loaded before posts.
    expect(groups.map((g) => [g.entity, g.items.length, g.reasons])).toEqual([
      ["users", 1, ["Email address invalid"]],
      ["posts", 2, ["Body too long"]],
    ]);
  });
});

describe("the log", () => {
  const out = [
    "◇ injected env (0) from .env",
    "63 migrations found in prisma/migrations",
    "",
    "No pending migrations to apply.",
    "npm notice",
    "npm notice New major version of npm available!",
  ].join("\n");

  it("reads each line's tone", () => {
    expect(toneOf("Applying migration `x`")).toBe("strong");
    expect(toneOf("ERROR: column exists")).toBe("error");
    expect(toneOf("warn: user 884 — email invalid")).toBe("warn");
    expect(toneOf("Loading users… 42/42 ✔")).toBe("ok");
    expect(toneOf("npm notice")).toBe("noise");
  });

  it("folds each run of noise into one row and drops blanks, keeping line numbers", () => {
    const view = buildLog(out, { hideNoise: true, q: "" });
    expect(view.rows).toEqual([
      { kind: "fold", count: 1 },
      { kind: "line", n: 2, text: "63 migrations found in prisma/migrations", tone: "info", hit: false },
      { kind: "line", n: 4, text: "No pending migrations to apply.", tone: "ok", hit: false },
      { kind: "fold", count: 2 },
    ]);
    expect(view).toMatchObject({ total: 6, hidden: 4 });
  });

  it("shows a noise line the search hits, and counts every match", () => {
    const view = buildLog(out, { hideNoise: true, q: "npm" });
    expect(view.rows.filter((r) => r.kind === "line" && r.hit).length).toBe(2);
    expect(view.matches).toBe(3); // "npm notice New major version of npm" holds two
  });
});

describe("entity order", () => {
  it("follows the loader, not jsonb's shortest-key-first order", async () => {
    const { inLoadOrder } = await import("./model");
    expect(inLoadOrder(["posts", "users", "threads", "forumNodes"])).toEqual(["users", "forumNodes", "threads", "posts"]);
    expect(inLoadOrder(["zeta", "post_like", "user"])).toEqual(["user", "post_like", "zeta"]);
  });
});

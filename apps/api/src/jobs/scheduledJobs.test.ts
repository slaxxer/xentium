/**
 * Default-schedule jitter for the jobs that call the license server.
 *
 * Every install ships the same `defaultCron`, so an unjittered "30 2 * * *" means
 * every Xentium instance in the world contacts the marketplace inside the same
 * minute. Three properties make the fix actually work, and each fails silently
 * if broken — hence this file:
 *
 *  1. STABLE. The offset is derived from the siteId, not randomness. A per-boot
 *     random value still spreads load, so nothing looks wrong — but BullMQ would
 *     rewrite the job scheduler on every restart, and the job would drift.
 *  2. DISTINCT PER INSTALL. The whole point. (Seeded with the job key too, so
 *     the spread stays correct if a second license-server job is ever added.)
 *  3. NEVER LOAD-BEARING. An install with no identity row must still get a
 *     schedule — spreading load is an optimisation, and must not be able to
 *     leave a job unscheduled.
 *
 * The retirement of the old separate `license-refresh` job is pinned here too:
 * a deleted job definition is never visited by the scheduling loop, so its Redis
 * repeat entry has to be removed explicitly or it fires forever.
 *
 * And an admin who picks a time must keep exactly that time.
 *
 * `queues` is mocked because importing the real module opens BullMQ connections
 * at module scope; none of the maths under test touches a queue.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const install: { siteId: string | null } = { siteId: "11111111-1111-4111-8111-111111111111" };
let storedConfig: unknown = null;

vi.mock("../infrastructure/queue.js", () => {
  const q = () => ({ upsertJobScheduler: async () => {}, removeJobScheduler: async () => {} });
  return {
    queues: new Proxy({}, { get: () => q() }),
  };
});

vi.mock("../infrastructure/db.js", () => ({
  prisma: {
    install: { findFirst: async () => (install.siteId === null ? null : { siteId: install.siteId }) },
    setting: {
      findUnique: async () => (storedConfig === null ? null : { value: storedConfig }),
      upsert:     async () => ({}),
    },
  },
}));

const { SCHEDULED_JOBS, RETIRED_SCHEDULERS, getJobConfig, getJobDef } = await import("./scheduledJobs.js");

const marketplaceSync = getJobDef("update-check")!;   // "Marketplace sync"
const banExpiry       = getJobDef("ban-expiry")!;

beforeEach(() => {
  install.siteId = "11111111-1111-4111-8111-111111111111";
  storedConfig = null;
});

describe("scheduled job default jitter", () => {
  it("marks exactly the license-server job for spreading", () => {
    const jittered = SCHEDULED_JOBS.filter((j) => j.jitterDefault).map((j) => j.key).sort();
    // Local jobs have no reason to spread — they hit nothing but this database.
    expect(jittered).toEqual(["update-check"]);
  });

  it("no longer schedules license-refresh separately, and tears the old one down", () => {
    // The merge is only safe if the retired scheduler is actively removed:
    // deleting a job definition does NOT unschedule it (see RETIRED_SCHEDULERS).
    expect(getJobDef("license-refresh")).toBeUndefined();
    expect(RETIRED_SCHEDULERS.map((r) => r.schedulerId)).toContain("license-refresh-daily");
  });

  it("no longer auto-publishes theme drafts, and tears the old schedule down", () => {
    // Drafts autosave, so a timed publish put unfinished work live unseen.
    expect(getJobDef("appearance-publish")).toBeUndefined();
    const retired = RETIRED_SCHEDULERS.find((r) => r.schedulerId === "appearance-publish-repeat");
    expect(retired?.jobKey).toBe("appearance-publish");
  });

  it("is stable across calls for the same install", async () => {
    const a = await getJobConfig(marketplaceSync);
    const b = await getJobConfig(marketplaceSync);
    expect(a.dailyTime).toBe(b.dailyTime);
    expect(a.dailyTime).toMatch(/^\d{2}:\d{2}$/);
  });

  it("gives two installs different times", async () => {
    const first = await getJobConfig(marketplaceSync);
    install.siteId = "22222222-2222-4222-8222-222222222222";
    const second = await getJobConfig(marketplaceSync);
    expect(first.dailyTime).not.toBe(second.dailyTime);
  });

  it("spreads across the whole day, not just around the code default", async () => {
    const hours = new Set<string>();
    for (let i = 0; i < 60; i++) {
      install.siteId = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      hours.add((await getJobConfig(marketplaceSync)).dailyTime!.slice(0, 2));
    }
    // 60 installs landing in one or two hours would mean the hash is barely moving.
    expect(hours.size).toBeGreaterThan(8);
  });

  it("falls back to the code default when the install has no identity yet", async () => {
    install.siteId = null;
    const cfg = await getJobConfig(marketplaceSync);
    expect(cfg.dailyTime).toBe("02:30"); // the sync job's own "30 2 * * *"
  });

  it("leaves jobs that are not marked for spreading alone", async () => {
    const cfg = await getJobConfig(banExpiry);
    expect(cfg.dailyTime).toBe("02:00");
  });

  it("never overrides a time the admin chose", async () => {
    storedConfig = { enabled: true, mode: "daily", dailyTime: "03:30", tz: "UTC" };
    const cfg = await getJobConfig(marketplaceSync);
    expect(cfg.dailyTime).toBe("03:30");
  });

  it("still spreads when a stored config does not name a time", async () => {
    // A partial row (e.g. the admin only toggled `enabled`) must not resurrect
    // the unjittered default through the object spread.
    storedConfig = { enabled: false };
    const cfg = await getJobConfig(marketplaceSync);
    expect(cfg.enabled).toBe(false);
    expect(cfg.dailyTime).not.toBe("02:30");
  });
});

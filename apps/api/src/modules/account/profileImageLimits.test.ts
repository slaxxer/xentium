/**
 * Per-rank profile image limits.
 *
 * ⚠ These settings existed since Phase 7 and were enforced NOWHERE. That is exactly
 * why this file leans on the boundaries: the risk in switching a dormant setting on
 * is not that it fails to refuse, it is that it starts refusing people it should not.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const limits = vi.fn();
vi.mock("../progression/progression.service.js", () => ({
  progressionService: { getUserLimits: (...a: unknown[]) => limits(...a) },
}));

const { assertProfileImageAllowed } = await import("./profileImageLimits.js");

const NO_LADDER = {
  maxProfileImageBytes: null, allowedProfileImageTypes: [], canUploadCover: true, badgeLabel: null,
};

const file = (over: Partial<{ mimeType: string; bytes: number; kind: "avatar" | "cover" }> = {}) =>
  ({ mimeType: "image/png", bytes: 1000, kind: "avatar" as const, ...over });

beforeEach(() => { limits.mockReset(); limits.mockResolvedValue(NO_LADDER); });

describe("a site with no ladder", () => {
  /** ⚠ Progression is opt-in. Its absence must never lock anyone out. */
  it("allows anything the route already accepted", async () => {
    await expect(assertProfileImageAllowed("u1", file())).resolves.toBeUndefined();
    await expect(assertProfileImageAllowed("u1", file({ kind: "cover" }))).resolves.toBeUndefined();
  });
});

describe("the byte ceiling", () => {
  it("refuses an image over the rank's limit", async () => {
    limits.mockResolvedValue({ ...NO_LADDER, maxProfileImageBytes: 500 });
    await expect(assertProfileImageAllowed("u1", file({ bytes: 501 }))).rejects.toMatchObject({
      httpStatus: 413, code: "XEC-STORE-7001",
    });
  });

  it("allows an image exactly at the limit", async () => {
    limits.mockResolvedValue({ ...NO_LADDER, maxProfileImageBytes: 500 });
    await expect(assertProfileImageAllowed("u1", file({ bytes: 500 }))).resolves.toBeUndefined();
  });

  /** `null` is "unlimited", not "zero". */
  it("treats a null ceiling as no ceiling", async () => {
    limits.mockResolvedValue({ ...NO_LADDER, maxProfileImageBytes: null });
    await expect(assertProfileImageAllowed("u1", file({ bytes: 99_999_999 }))).resolves.toBeUndefined();
  });
});

describe("the type list", () => {
  /**
   * ⚠ THE trap in this feature. An empty list is a rung nobody has configured, not a
   * rung that forbids everything — reading it the other way would refuse every avatar
   * on every site the moment progression was switched on.
   */
  it("treats an empty list as no restriction", async () => {
    limits.mockResolvedValue({ ...NO_LADDER, allowedProfileImageTypes: [] });
    await expect(assertProfileImageAllowed("u1", file({ mimeType: "image/gif" }))).resolves.toBeUndefined();
  });

  it("refuses a type the rank does not list", async () => {
    limits.mockResolvedValue({ ...NO_LADDER, allowedProfileImageTypes: ["image/png"] });
    await expect(assertProfileImageAllowed("u1", file({ mimeType: "image/gif" }))).rejects.toMatchObject({
      httpStatus: 415, code: "XEC-STORE-7002",
    });
  });

  /** "Animated covers unlock at Veteran" is exactly this: gif in the list. */
  it("allows a listed type", async () => {
    limits.mockResolvedValue({ ...NO_LADDER, allowedProfileImageTypes: ["image/png", "image/gif"] });
    await expect(assertProfileImageAllowed("u1", file({ mimeType: "image/gif" }))).resolves.toBeUndefined();
  });
});

describe("the cover gate", () => {
  it("refuses a cover when the rank may not set one", async () => {
    limits.mockResolvedValue({ ...NO_LADDER, canUploadCover: false, badgeLabel: "Newcomer" });
    await expect(assertProfileImageAllowed("u1", file({ kind: "cover" }))).rejects.toMatchObject({
      httpStatus: 403, code: "XEC-API-4003",
    });
  });

  /** ⚠ The gate is the COVER's alone — it must not touch avatars. */
  it("still allows an avatar at a rank that cannot set a cover", async () => {
    limits.mockResolvedValue({ ...NO_LADDER, canUploadCover: false });
    await expect(assertProfileImageAllowed("u1", file({ kind: "avatar" }))).resolves.toBeUndefined();
  });

  it("allows a cover when the rank may set one", async () => {
    limits.mockResolvedValue({ ...NO_LADDER, canUploadCover: true });
    await expect(assertProfileImageAllowed("u1", file({ kind: "cover" }))).resolves.toBeUndefined();
  });
});

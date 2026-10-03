/**
 * The date of birth on a profile header. Every case here is a privacy rule: the
 * member's Privacy choice, then the field's own visibility on top of it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = {
  userProfileField:      { findUnique: vi.fn() },
  userProfileFieldValue: { findUnique: vi.fn() },
};
vi.mock("../../infrastructure/db.js", () => ({ prisma: db }));

const { getDobForUser, ageOn } = await import("./profileDob.js");

const stored = (value: string | null, privacy = "everyone") =>
  db.userProfileFieldValue.findUnique.mockResolvedValue(value === null ? null : { value, privacy });

beforeEach(() => {
  db.userProfileField.findUnique.mockReset().mockResolvedValue({ id: "f-dob" });
  db.userProfileFieldValue.findUnique.mockReset();
});

describe("ageOn", () => {
  it("counts whole years, turning over on the birthday itself", () => {
    const born = new Date("2006-03-05");
    expect(ageOn(born, new Date("2026-03-04"))).toBe(19);
    expect(ageOn(born, new Date("2026-03-05"))).toBe(20);
  });
});

describe("what a profile shows", () => {
  it("the age by default", async () => {
    stored("2000-01-01");
    expect(await getDobForUser("u1", "age", false)).toMatchObject({ kind: "age" });
  });

  it("month and day only — never the year — for a birthday", async () => {
    stored("2000-03-05");
    expect(await getDobForUser("u1", "birthday", false)).toEqual({ kind: "birthday", month: 3, day: 5 });
  });

  it("nothing when the member hides it", async () => {
    stored("2000-03-05");
    expect(await getDobForUser("u1", "hidden", true)).toBeNull();
  });

  it("nothing when the field is visible to nobody", async () => {
    stored("2000-03-05", "nobody");
    expect(await getDobForUser("u1", "age", true)).toBeNull();
  });

  /** ⚠ This was missed before: members-only reached guests on the profile header. */
  it("a members-only date to members, and not to guests", async () => {
    stored("2000-03-05", "members");
    expect(await getDobForUser("u1", "age", false)).toBeNull();
    expect(await getDobForUser("u1", "age", true)).toMatchObject({ kind: "age" });
  });

  it("nothing for a date in the future", async () => {
    stored("2222-02-22");
    expect(await getDobForUser("u1", "age", true)).toBeNull();
  });

  it("nothing when no date was entered", async () => {
    stored(null);
    expect(await getDobForUser("u1", "age", true)).toBeNull();
  });
});

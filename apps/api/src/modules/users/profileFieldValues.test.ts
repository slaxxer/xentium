/**
 * Profile field values are checked on the server: the date picker's min/max are
 * a hint the browser may ignore (a member typed the year 2222 and registered).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const findMany = vi.fn();
vi.mock("../../infrastructure/db.js", () => ({ prisma: { userProfileField: { findMany: (...a: unknown[]) => findMany(...a) } } }));

const { assertProfileFieldValues, isValidDob, parseIsoDate } = await import("./profileFieldValues.js");

const FIELDS = [
  { id: "dob", key: "date_of_birth", type: "date" },
  { id: "met", key: "first_meetup", type: "date" },
  { id: "loc", key: "location", type: "text" },
];
beforeEach(() => {
  findMany.mockReset();
  findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => FIELDS.filter((f) => where.id.in.includes(f.id)));
});

describe("assertProfileFieldValues", () => {
  it("refuses a date of birth in the future (the 2222 bug)", async () => {
    await expect(assertProfileFieldValues([{ fieldId: "dob", value: "2222-01-01" }]))
      .rejects.toMatchObject({ code: "XEC-USER-4017", httpStatus: 422 });
  });
  it("refuses a date of birth in 1900 or before", async () => {
    await expect(assertProfileFieldValues([{ fieldId: "dob", value: "1899-12-31" }]))
      .rejects.toMatchObject({ code: "XEC-USER-4017" });
  });
  it("accepts a real date of birth, an empty one, and other fields as they are", async () => {
    await expect(assertProfileFieldValues([
      { fieldId: "dob", value: "1990-05-17" }, { fieldId: "loc", value: "2222" },
    ])).resolves.toBeUndefined();
    await expect(assertProfileFieldValues([{ fieldId: "dob", value: "" }])).resolves.toBeUndefined();
    expect(findMany).toHaveBeenCalledTimes(1);   // the empty value never hit the database
  });
  it("lets other date fields lie in the future, but they must be real dates", async () => {
    await expect(assertProfileFieldValues([{ fieldId: "met", value: "2030-06-01" }])).resolves.toBeUndefined();
    await expect(assertProfileFieldValues([{ fieldId: "met", value: "2030-02-31" }]))
      .rejects.toMatchObject({ code: "XEC-API-4001" });
  });
});

describe("parseIsoDate", () => {
  it("accepts a real calendar date", () => {
    expect(parseIsoDate("1990-05-17")?.toISOString()).toBe("1990-05-17T00:00:00.000Z");
  });
  it("refuses impossible dates and other formats", () => {
    for (const v of ["2023-02-30", "1990-13-01", "17.05.1990", "1990-5-17", "", "abc"]) expect(parseIsoDate(v)).toBeNull();
  });
});

describe("isValidDob", () => {
  const now = new Date("2026-10-20T10:00:00Z");
  it("accepts a date after 1900 and before today", () => {
    expect(isValidDob("1990-05-17", now)).toBe(true);
    expect(isValidDob("1900-01-02", now)).toBe(true);
    expect(isValidDob("2026-10-19", now)).toBe(true);
  });
  it("refuses the future, today, and 1900 or earlier", () => {
    expect(isValidDob("2222-01-01", now)).toBe(false);
    expect(isValidDob("2026-10-20", now)).toBe(false);
    expect(isValidDob("1900-01-01", now)).toBe(false);
    expect(isValidDob("1850-06-01", now)).toBe(false);
  });
});

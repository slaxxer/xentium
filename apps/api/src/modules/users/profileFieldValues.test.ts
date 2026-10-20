/**
 * Profile field values are checked on the server: the date picker's min/max are
 * a hint the browser may ignore (a member typed the year 2222 and registered).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const findMany = vi.fn();
vi.mock("../../infrastructure/db.js", () => ({ prisma: { userProfileField: { findMany: (...a: unknown[]) => findMany(...a) } } }));

const { assertProfileFieldValues, isValidDob, parseIsoDate, ageOn } = await import("./profileFieldValues.js");

const FIELDS = [
  { id: "dob", key: "date_of_birth", label: "Date of birth", type: "date", minAge: 16 },
  { id: "met", key: "first_meetup", label: "First meetup", type: "date" },
  { id: "loc", key: "location", label: "Location", type: "text" },
  { id: "gh", key: "github", label: "GitHub", type: "text", maxLength: 39 },
  { id: "bio", key: "story", label: "Story", type: "longtext" },
  { id: "mail", key: "contact", label: "Contact", type: "email" },
  { id: "web", key: "website", label: "Website", type: "url" },
  { id: "pick", key: "role", label: "Role", type: "choice", options: ["Player", "Coach"] },
];
let REQUIRED: { id: string; label: string }[] = [];
beforeEach(() => {
  REQUIRED = [];
  findMany.mockReset();
  findMany.mockImplementation(async ({ where }: { where: { id?: { in: string[] }; requiredOnRegistration?: boolean } }) =>
    where.requiredOnRegistration ? REQUIRED : FIELDS.filter((f) => where.id!.in.includes(f.id)));
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

describe("field settings", () => {
  const NOW = new Date("2026-10-20T12:00:00Z");
  const one = (fieldId: string, value: string, registration = false) =>
    assertProfileFieldValues([{ fieldId, value }], { registration, now: NOW });

  it("counts age in whole years, a day before the birthday included", () => {
    expect(ageOn("2010-10-20", NOW)).toBe(16);
    expect(ageOn("2010-10-21", NOW)).toBe(15);
  });
  it("refuses someone under the minimum age at sign-up (XEC-USER-4019)", async () => {
    await expect(one("dob", "2010-10-21", true)).rejects.toMatchObject({ code: "XEC-USER-4019", httpStatus: 422 });
    await expect(one("dob", "2010-10-20", true)).resolves.toBeUndefined();
  });
  it("applies the minimum age only at sign-up, not to members editing their profile", async () => {
    await expect(one("dob", "2015-01-01")).resolves.toBeUndefined();
  });
  it("caps text at the field's longest answer, else the type's", async () => {
    await expect(one("gh", "x".repeat(40))).rejects.toMatchObject({ code: "XEC-USER-4018" });
    await expect(one("gh", "x".repeat(39))).resolves.toBeUndefined();
    await expect(one("loc", "x".repeat(256))).rejects.toMatchObject({ code: "XEC-USER-4018" });
    await expect(one("bio", "x".repeat(2000))).resolves.toBeUndefined();
    await expect(one("bio", "x".repeat(2001))).rejects.toMatchObject({ code: "XEC-USER-4018" });
  });
  it("accepts only the listed options for a choice", async () => {
    await expect(one("pick", "Coach")).resolves.toBeUndefined();
    await expect(one("pick", "Referee")).rejects.toMatchObject({ code: "XEC-USER-4018" });
  });
  it("checks email and web address shapes", async () => {
    await expect(one("mail", "me@example.org")).resolves.toBeUndefined();
    await expect(one("mail", "not an email")).rejects.toMatchObject({ code: "XEC-USER-4018" });
    await expect(one("web", "example.org/me")).resolves.toBeUndefined();
    await expect(one("web", "javascript:alert(1)")).rejects.toMatchObject({ code: "XEC-USER-4018" });
  });
});

describe("required at sign-up", () => {
  it("refuses a sign-up without a required field, empty or left out (XEC-USER-4020)", async () => {
    REQUIRED = [{ id: "dob", label: "Date of birth" }];
    await expect(assertProfileFieldValues([], { registration: true })).rejects.toMatchObject({ code: "XEC-USER-4020", httpStatus: 422 });
    await expect(assertProfileFieldValues([{ fieldId: "dob", value: "  " }], { registration: true })).rejects.toMatchObject({ code: "XEC-USER-4020" });
    await expect(assertProfileFieldValues([{ fieldId: "dob", value: "1990-05-01" }], { registration: true })).resolves.toBeUndefined();
  });
  it("does not require anything outside sign-up (a member may clear it later)", async () => {
    REQUIRED = [{ id: "dob", label: "Date of birth" }];
    await expect(assertProfileFieldValues([])).resolves.toBeUndefined();
  });
});

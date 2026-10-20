import { describe, it, expect } from "vitest";
import { DOB_MIN, dobMax } from "./dob";

describe("date-of-birth input bounds", () => {
  it("run from 1900-01-02 to yesterday in UTC, what the server accepts", () => {
    expect(DOB_MIN).toBe("1900-01-02");
    expect(dobMax(new Date("2026-10-20T10:00:00Z"))).toBe("2026-10-19");
    expect(dobMax(new Date("2026-01-01T00:30:00Z"))).toBe("2025-12-31");
  });
});

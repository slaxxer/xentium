/**
 * The site's dates and times: the admin's zone, 12/24-hour clock and date style, and
 * "Today"/"Yesterday" decided in THAT zone, not the reader's.
 */
import { describe, expect, it } from "vitest";
import { formatDate, formatStamp, formatTime, type TimeConfig } from "./datetime";

const cfg = (c: Partial<TimeConfig>): TimeConfig => ({ zone: "UTC", timeFormat: "24h", dateFormat: "medium", ...c });
const at = "2026-10-07T13:05:00Z";

describe("time", () => {
  it("writes the admin's clock", () => {
    expect(formatTime(at, cfg({ timeFormat: "24h" }), "en")).toBe("13:05");
    expect(formatTime(at, cfg({ timeFormat: "12h" }), "en")).toMatch(/^1:05\sPM$/);
    // Left to the language: English writes 12-hour, German 24-hour.
    expect(formatTime(at, cfg({ timeFormat: "auto" }), "en-US")).toMatch(/^1:05\sPM$/);
    expect(formatTime(at, cfg({ timeFormat: "auto" }), "de")).toBe("13:05");
  });

  it("writes it in the admin's zone", () => {
    expect(formatTime(at, cfg({ zone: "Europe/Berlin" }), "en")).toBe("15:05");
    expect(formatTime(at, cfg({ zone: "America/New_York" }), "en")).toBe("09:05");
  });
});

describe("date", () => {
  it("follows the chosen style", () => {
    expect(formatDate(at, cfg({ dateFormat: "iso" }), "en")).toBe("2026-10-07");
    expect(formatDate(at, cfg({ dateFormat: "long" }), "en-GB")).toBe("7 October 2026");
    expect(formatDate(at, cfg({ dateFormat: "medium" }), "en-GB")).toBe("7 Oct 2026");
    expect(formatDate(at, cfg({ dateFormat: "numeric" }), "de")).toBe("07.10.2026");
  });

  it("moves to the next day when the zone does", () => {
    expect(formatDate("2026-10-07T23:30:00Z", cfg({ zone: "Asia/Tokyo", dateFormat: "iso" }), "en")).toBe("2026-10-08");
  });
});

describe("stamp", () => {
  const now = new Date("2026-10-07T18:00:00Z");

  it("says today or yesterday, in the reader's language", () => {
    expect(formatStamp(at, cfg({}), "en", now)).toBe("Today, 13:05");
    expect(formatStamp("2026-10-06T21:00:00Z", cfg({}), "de", now)).toBe("Gestern, 21:00");
  });

  it("writes the date and the time for anything older", () => {
    expect(formatStamp("2026-09-30T08:15:00Z", cfg({}), "en-GB", now)).toBe("30 Sept 2026, 08:15");
  });

  it("decides today in the SITE's zone", () => {
    // At 10:00 UTC on the 7th, a message from 23:30 UTC on the 6th was YESTERDAY in
    // UTC, but in Tokyo both moments fall on the 7th.
    const morning = new Date("2026-10-07T10:00:00Z");
    expect(formatStamp("2026-10-06T23:30:00Z", cfg({}), "en", morning)).toBe("Yesterday, 23:30");
    expect(formatStamp("2026-10-06T23:30:00Z", cfg({ zone: "Asia/Tokyo" }), "en", morning)).toBe("Today, 08:30");
  });
});

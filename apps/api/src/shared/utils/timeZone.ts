/** An IANA zone the runtime knows, or null ("visitor", empty, unknown). */
export function validZone(zone: unknown): string | null {
  if (typeof zone !== "string" || !zone || zone === "visitor") return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

/** The wall-clock parts of an instant in `zone`. */
function partsIn(zone: string, t: number) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { y: +p.year!, m: +p.month!, d: +p.day!, h: +p.hour!, min: +p.minute!, s: +p.second! };
}

/** How far `zone` is ahead of UTC at instant `t`, in ms. */
export function zoneOffset(zone: string, t: number): number {
  const p = partsIn(zone, t);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(t / 1000) * 1000;
}

/** Midnight of the day `date` falls on in `zone`, as an instant. DST-safe. */
export function startOfDayIn(zone: string, date: Date): Date {
  const p = partsIn(zone, date.getTime());
  const wall = Date.UTC(p.y, p.m - 1, p.d);
  // The offset at midnight can differ from the guess's (a DST change that day).
  const guess = wall - zoneOffset(zone, wall);
  return new Date(wall - zoneOffset(zone, guess));
}

/** The calendar day `date` falls on in `zone`, as YYYY-MM-DD. */
export function dayKeyIn(zone: string, date: Date): string {
  const p = partsIn(zone, date.getTime());
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

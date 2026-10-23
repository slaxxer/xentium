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

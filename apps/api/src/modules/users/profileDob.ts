/**
 * The date of birth on a profile header: what the member allows, and only that.
 */
import { prisma } from "../../infrastructure/db.js";

/** What the profile header may show of a date of birth: the age, the birthday
 *  (month + day, never the year), or nothing. Locale-agnostic — the web formats it. */
export type ProfileDob = { kind: "age"; age: number } | { kind: "birthday"; month: number; day: number };

/** Resolve the visible date of birth for the profile header.
 *  `dobDisplay` (Account → Privacy) picks 'hidden' | 'age' | 'birthday'; the field's
 *  own visibility still applies on top — 'nobody' hides it, 'members' hides it from guests. */
export async function getDobForUser(
  userId: string, dobDisplay: string, isAuthenticated: boolean,
): Promise<ProfileDob | null> {
  if (dobDisplay === "hidden") return null;
  const field = await prisma.userProfileField.findUnique({ where: { key: "date_of_birth" } });
  if (!field) return null;
  const value = await prisma.userProfileFieldValue.findUnique({
    where: { userId_fieldId: { userId, fieldId: field.id } },
  });
  if (!value || !value.value || value.privacy === "nobody") return null;
  if (value.privacy === "members" && !isAuthenticated) return null;
  const date = new Date(value.value);
  if (isNaN(date.getTime())) return null;

  // A date in the future (or centuries back) is a typo, not an age to print.
  const age = ageOn(date, new Date());
  if (age < 0 || age > 130) return null;

  const birthday = dobDisplay === "birthday";
  return birthday
    ? { kind: "birthday", month: date.getUTCMonth() + 1, day: date.getUTCDate() }
    : { kind: "age", age };
}

/** Whole years between a birth date and `now`. */
export function ageOn(born: Date, now: Date): number {
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  const m = now.getUTCMonth() - born.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < born.getUTCDate())) age--;
  return age;
}

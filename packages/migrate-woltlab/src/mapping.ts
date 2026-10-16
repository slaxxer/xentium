import type { ImportedUser } from "@xentium/migrate-core";

/** Pure decisions for the WoltLab adapter (unit-tested without MySQL). */

/** WoltLab tables carry an instance number: wcf1_, wbb1_. `--prefix` takes "1", "wcf1_" or "wbb1_". */
export function prefixesOf(tablePrefix: string | undefined): { wcf: string; wbb: string; n: number } {
  const m = /^(?:wcf|wbb)?(\d+)_?$/i.exec((tablePrefix ?? "").trim());
  const n = m ? Number(m[1]) : 1;
  return { wcf: `wcf${n}_`, wbb: `wbb${n}_`, n };
}

/**
 * The stored password as Xentium can verify it. WoltLab writes "<Algorithm>:<hash>"
 * (5.4 and later); a bare bcrypt string is an older double-bcrypt hash. Hashes a board
 * kept from its own earlier migration (phpBB, vBulletin, …) aren't carried: those
 * members reset their password once.
 */
export function passwordOf(stored: string | null): Pick<ImportedUser, "passwordHash" | "passwordScheme"> {
  if (!stored) return {};
  if (/^\$2[aby]\$\d\d\$/.test(stored)) return { passwordHash: stored, passwordScheme: "wcf-double-bcrypt" };
  const i = stored.indexOf(":");
  if (i < 0) return {};
  const algo = stored.slice(0, i).toLowerCase();
  const hash = stored.slice(i + 1);
  if (algo === "bcrypt" && /^\$2[aby]\$/.test(hash)) return { passwordHash: hash, passwordScheme: "bcrypt" };
  if ((algo === "doublebcrypt" || algo === "wcf2") && /^\$2[aby]\$/.test(hash)) {
    return { passwordHash: hash, passwordScheme: "wcf-double-bcrypt" };
  }
  if (algo === "wcf1" && /^[0-9a-f]{40}:/i.test(hash)) return { passwordHash: hash, passwordScheme: "wcf1" };
  return {};
}

export type BoardKind = "forum" | "category" | null;

/** wbb board types: 0 = board, 1 = category, 2 = external link (not imported). */
export function boardKind(boardType: number): BoardKind {
  if (boardType === 0) return "forum";
  if (boardType === 1) return "category";
  return null;
}

export interface WbbThreadFlags {
  userID: number | null;
  isDisabled?: number;
  isDeleted?: number;
  movedThreadID?: number | null;
}

export function threadSkipReason(t: WbbThreadFlags): string | null {
  if (t.movedThreadID) return "moved-thread link";
  if (t.isDeleted) return "deleted";
  if (t.isDisabled) return "awaiting moderation";
  if (!t.userID) return "started by a guest (no account to attach it to)";
  return null;
}

export function postSkipReason(p: { userID: number | null; isDisabled?: number; isDeleted?: number }): string | null {
  if (p.isDeleted) return "deleted";
  if (p.isDisabled) return "awaiting moderation";
  if (!p.userID) return "written by a guest (no account to attach it to)";
  return null;
}

/** Is this a WoltLab language key instead of a literal title? (multilingual sites) */
export const isLanguageKey = (s: string) => /^wcf\.|^wbb\./.test(s) && /^[a-z0-9._-]+$/i.test(s) && !/\s/.test(s);

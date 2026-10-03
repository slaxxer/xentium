/**
 * Optimistic concurrency on the layout draft.
 *
 * The editor autosaves, so two admins — or one admin in two tabs — on the same
 * selector used to overwrite each other silently: last write won, neither was told,
 * and the loser's work was gone with no trace. Every save now carries the revision it
 * was built on and a stale one is refused.
 *
 * The check has to be made BY THE DATABASE, not by a read followed by a write, which
 * is the race it exists to close — so these drive the service rather than mocking it.
 */
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { DEFAULT_VARIANT, type LayoutDocument, type LayoutSelector } from "@xentium/contracts";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { layoutService } from "./layout.service.js";

const USER = null as unknown as string; // `updatedById` is nullable
const SELECTOR: LayoutSelector = { templateKey: "home", variant: DEFAULT_VARIANT };

const docWith = (text: string): LayoutDocument => ({
  templateKey:   "home",
  schemaVersion: 1,
  regions: { main: [{ id: "h", type: "heading", props: { text, level: 2 } }] },
});

/** The heading text stored right now — which edit actually won. */
async function storedText(): Promise<string | undefined> {
  const doc = (await layoutService.getDraft(SELECTOR, "")).document;
  return (doc.regions.main?.[0]?.props as { text?: string } | undefined)?.text;
}

const conflictOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e as { httpStatus?: number; details?: { version?: string | null } };
  }
};

beforeEach(async () => {
  assertDisposableDatabase();
  await prisma.layout.deleteMany({});
  layoutService.bustCache();
});

afterEach(async () => {
  await prisma.layout.deleteMany({});
  layoutService.bustCache();
});

describe("layout draft concurrency", () => {
  it("reports no revision for a selector with no row, and one after a save", async () => {
    expect((await layoutService.getDraft(SELECTOR, "")).version).toBeNull();

    const saved = await layoutService.saveDraft(SELECTOR, docWith("first"), USER, null, "");
    expect(saved.version).toEqual(expect.any(String));
    expect((await layoutService.getDraft(SELECTOR, "")).version).toBe(saved.version);
  });

  it("accepts a save built on the current revision", async () => {
    const first = await layoutService.saveDraft(SELECTOR, docWith("first"), USER, null, "");
    const second = await layoutService.saveDraft(SELECTOR, docWith("second"), USER, first.version, "");

    expect(await storedText()).toBe("second");
    // The revision must MOVE, or an editor's own next save would collide with itself.
    expect(second.version).not.toBe(first.version);
  });

  it("refuses a save built on a revision somebody else has replaced", async () => {
    const mine = await layoutService.saveDraft(SELECTOR, docWith("mine"), USER, null, "");
    // The other tab, working from the same starting point, gets there first.
    await layoutService.saveDraft(SELECTOR, docWith("theirs"), USER, mine.version, "");

    const err = await conflictOf(
      layoutService.saveDraft(SELECTOR, docWith("mine again"), USER, mine.version, ""),
    );
    expect(err?.httpStatus).toBe(409);
    expect(await storedText()).toBe("theirs"); // their work is still there
  });

  it("refuses a first write when someone else created the row meanwhile", async () => {
    // Both tabs read nothing, so both carry `null`. The second must not win silently.
    await layoutService.saveDraft(SELECTOR, docWith("theirs"), USER, null, "");

    const err = await conflictOf(
      layoutService.saveDraft(SELECTOR, docWith("mine"), USER, null, ""),
    );
    expect(err?.httpStatus).toBe(409);
    expect(await storedText()).toBe("theirs");
  });

  it("hands back the current revision, so 'keep mine' is one deliberate round trip", async () => {
    const mine = await layoutService.saveDraft(SELECTOR, docWith("mine"), USER, null, "");
    await layoutService.saveDraft(SELECTOR, docWith("theirs"), USER, mine.version, "");

    const err = await conflictOf(
      layoutService.saveDraft(SELECTOR, docWith("mine again"), USER, mine.version, ""),
    );
    // Exactly what the editor's "Keep mine" button replays.
    await layoutService.saveDraft(SELECTOR, docWith("mine again"), USER, err!.details!.version, "");
    expect(await storedText()).toBe("mine again");
  });

  it("skips the check entirely when no revision is supplied", async () => {
    // The internal path: theme import, revert-to-theme, scripts. None of them is
    // racing an admin, and none has a revision to quote.
    await layoutService.saveDraft(SELECTOR, docWith("first"), USER, null, "");
    await layoutService.saveDraft(SELECTOR, docWith("unconditional"), USER, undefined, "");
    expect(await storedText()).toBe("unconditional");
  });
});

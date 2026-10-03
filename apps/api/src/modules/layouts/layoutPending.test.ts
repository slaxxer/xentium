/**
 * "Pending publish" is about CONTENT, not key order.
 *
 * A stored draft comes back from jsonb in Postgres's key order; the code default it
 * falls back to keeps its source order. They are the same document, and the editor
 * must not report one as a change waiting to be published.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_LAYOUTS, type LayoutDocument } from "@xentium/contracts";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { layoutService } from "./layout.service.js";

/** The same document with every object's keys reversed. */
const reversed = (v: unknown): unknown => Array.isArray(v)
  ? v.map(reversed)
  : v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reversed(x)]))
    : v;

beforeEach(async () => { assertDisposableDatabase(); await prisma.layout.deleteMany({}); layoutService.bustCache(); });
afterEach(async () => { await prisma.layout.deleteMany({}); layoutService.bustCache(); });

describe("pending status", () => {
  it("does not report a draft equal to the default it falls back to", async () => {
    const doc = reversed(structuredClone(DEFAULT_LAYOUTS["chrome.header"])) as LayoutDocument;
    await layoutService.saveDraft({ templateKey: "chrome.header", variant: "" }, doc, null as unknown as string, undefined, "");
    expect((await layoutService.getDraftStatus("")).pending).toEqual([]);
    expect((await layoutService.getOwnership(""))["chrome.header"]?.customised).toBe(false);
  });
});

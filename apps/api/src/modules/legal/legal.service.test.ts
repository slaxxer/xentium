/**
 * Legal documents: the draft → publish rules, against the real database.
 *
 * Driven through the service rather than mocked because the part most likely to be
 * wrong is Postgres JSON null handling — "not published" is a NULL `body`, and a
 * filter that confused SQL NULL with JSON `null` would list an offline imprint.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { legalService } from "./legal.service.js";

const USER = null as unknown as string; // `updatedById` is nullable
const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const EMPTY = { type: "doc", content: [{ type: "paragraph" }] };

const statusOf = async (p: Promise<unknown>) => {
  try { await p; return null; } catch (e) { return (e as { httpStatus?: number }).httpStatus ?? -1; }
};

beforeEach(async () => {
  assertDisposableDatabase();
  await prisma.legalDocument.deleteMany({});
});
afterEach(async () => {
  await prisma.legalDocument.deleteMany({});
});

describe("legal documents", () => {
  it("lists all four for the editor, written or not, in footer order", async () => {
    const all = await legalService.listAll();
    expect(all.map((d) => d.key)).toEqual(["imprint", "privacy", "terms", "disclaimer"]);
    expect(all.every((d) => d.draftBody === null && d.publishedAt === null)).toBe(true);
  });

  it("keeps a draft out of public view until it is published", async () => {
    await legalService.saveDraft("imprint", doc("Jane Doe, Berlin"), USER);
    expect(await legalService.listPublished()).toEqual([]);
    expect(await statusOf(legalService.getPublished("imprint"))).toBe(404);

    await legalService.publish("imprint", USER);
    expect((await legalService.listPublished()).map((d) => d.key)).toEqual(["imprint"]);
    expect((await legalService.getPublished("imprint")).body).toEqual(doc("Jane Doe, Berlin"));
  });

  it("serves the published text while a newer draft is being written", async () => {
    await legalService.saveDraft("terms", doc("v1"), USER);
    await legalService.publish("terms", USER);
    await legalService.saveDraft("terms", doc("v2 half-typ"), USER);
    expect((await legalService.getPublished("terms")).body).toEqual(doc("v1"));

    await legalService.discardDraft("terms", USER);
    expect((await legalService.listAll()).find((d) => d.key === "terms")!.draftBody).toEqual(doc("v1"));
  });

  it("refuses to publish a document with no text", async () => {
    expect(await statusOf(legalService.publish("privacy", USER))).toBe(422);
    await legalService.saveDraft("privacy", EMPTY, USER);
    expect(await statusOf(legalService.publish("privacy", USER))).toBe(422);
  });

  it("takes a document offline but keeps its text", async () => {
    await legalService.saveDraft("disclaimer", doc("No warranty."), USER);
    await legalService.publish("disclaimer", USER);
    await legalService.unpublish("disclaimer", USER);

    expect(await legalService.listPublished()).toEqual([]);
    expect(await statusOf(legalService.getPublished("disclaimer"))).toBe(404);
    expect((await legalService.listAll()).find((d) => d.key === "disclaimer")!.draftBody).toEqual(doc("No warranty."));
  });

  it("lists published documents in footer order, whatever order they went live", async () => {
    for (const key of ["terms", "imprint", "privacy"] as const) {
      await legalService.saveDraft(key, doc(key), USER);
      await legalService.publish(key, USER);
    }
    expect((await legalService.listPublished()).map((d) => d.key)).toEqual(["imprint", "privacy", "terms"]);
  });
});

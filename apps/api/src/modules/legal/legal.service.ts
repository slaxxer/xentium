import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../infrastructure/db.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import {
  LEGAL_DOCUMENTS,
  XEC,
  type AdminLegalDocument,
  type LegalDocumentKey,
  type LegalDocumentLink,
  type PublicLegalDocument,
} from "@xentium/contracts";

const notFound = () =>
  new XentiumError({ code: XEC.LEGAL_NOT_FOUND, httpStatus: 404, message: "Legal document not found" });

/** True when the doc holds any text. An empty editor still sends `{type:"doc"}`. */
function hasText(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const n = node as { text?: unknown; content?: unknown };
  if (typeof n.text === "string" && n.text.trim() !== "") return true;
  return Array.isArray(n.content) && n.content.some(hasText);
}

export const legalService = {
  // ── Public ──────────────────────────────────────────────────────────────

  /** Published documents, in footer order. */
  async listPublished(): Promise<LegalDocumentLink[]> {
    const rows = await prisma.legalDocument.findMany({
      where: { body: { not: Prisma.AnyNull }, publishedAt: { not: null } },
      select: { key: true, publishedAt: true },
    });
    const byKey = new Map(rows.map((r) => [r.key, r.publishedAt!]));
    return LEGAL_DOCUMENTS
      .filter((k) => byKey.has(k))
      .map((k) => ({ key: k, publishedAt: byKey.get(k)!.toISOString() }));
  },

  /** Whether joining (and staying) asks for consent: terms or a privacy policy is published. */
  async consentRequired(): Promise<boolean> {
    return (await this.listPublished()).some((d) => d.key === "terms" || d.key === "privacy");
  },

  async getPublished(key: LegalDocumentKey): Promise<PublicLegalDocument> {
    const row = await prisma.legalDocument.findUnique({ where: { key } });
    if (!row || row.body === null || !row.publishedAt) throw notFound();
    return { key, body: row.body, publishedAt: row.publishedAt.toISOString() };
  },

  // ── Admin ───────────────────────────────────────────────────────────────

  /** Every document, written or not, so the editor always has four tabs. */
  async listAll(): Promise<AdminLegalDocument[]> {
    const rows = await prisma.legalDocument.findMany({
      include: { updatedBy: { select: { username: true } } },
    });
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return LEGAL_DOCUMENTS.map((key) => {
      const r = byKey.get(key);
      return {
        key,
        draftBody:   r?.draftBody ?? null,
        body:        r?.body ?? null,
        publishedAt: r?.publishedAt?.toISOString() ?? null,
        updatedAt:   r?.updatedAt.toISOString() ?? null,
        updatedBy:   r?.updatedBy?.username ?? null,
      };
    });
  },

  async saveDraft(key: LegalDocumentKey, draftBody: unknown, userId: string): Promise<void> {
    const data = { draftBody: draftBody as Prisma.InputJsonValue, updatedById: userId };
    await prisma.legalDocument.upsert({ where: { key }, update: data, create: { key, ...data } });
  },

  /** The draft goes live. Refused when there is nothing in it — an empty imprint is not one. */
  async publish(key: LegalDocumentKey, userId: string): Promise<void> {
    const row = await prisma.legalDocument.findUnique({ where: { key } });
    if (!row || !hasText(row.draftBody)) {
      throw new XentiumError({ code: XEC.LEGAL_EMPTY, httpStatus: 422, message: "Nothing to publish" });
    }
    await prisma.legalDocument.update({
      where: { key },
      data: { body: row.draftBody as Prisma.InputJsonValue, publishedAt: new Date(), updatedById: userId },
    });
  },

  /** Take it offline. The draft is kept, so publishing again needs no retyping. */
  async unpublish(key: LegalDocumentKey, userId: string): Promise<void> {
    await prisma.legalDocument.updateMany({
      where: { key },
      data: { body: Prisma.DbNull, publishedAt: null, updatedById: userId },
    });
  },

  /** Throw the draft away and start again from what is live. */
  async discardDraft(key: LegalDocumentKey, userId: string): Promise<void> {
    const row = await prisma.legalDocument.findUnique({ where: { key } });
    if (!row || row.body === null) return;
    await prisma.legalDocument.update({
      where: { key },
      data: { draftBody: row.body as Prisma.InputJsonValue, updatedById: userId },
    });
  },
};

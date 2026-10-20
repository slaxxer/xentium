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

type RequiredDoc = { key: LegalDocumentKey; revision: number; reacceptGroupIds: string[] };

/** Published documents members must accept, in footer order. */
async function requiredDocs(): Promise<RequiredDoc[]> {
  const rows = await prisma.legalDocument.findMany({
    where: { requireAcceptance: true, body: { not: Prisma.AnyNull }, publishedAt: { not: null } },
    select: { key: true, revision: true, reacceptGroupIds: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return LEGAL_DOCUMENTS.filter((k) => byKey.has(k)).map((k) => ({ ...byKey.get(k)!, key: k }));
}

/** Members who still have to accept a document (the same rule as pendingFor). */
function pendingCount(d: { key: string; revision: number; reacceptGroupIds: string[] }): Promise<number> {
  return prisma.user.count({
    where: {
      OR: [
        { legalAcceptances: { none: { documentKey: d.key } } },
        {
          legalAcceptances: { some: { documentKey: d.key, revision: { lt: d.revision } } },
          ...(d.reacceptGroupIds.length ? { groups: { some: { groupId: { in: d.reacceptGroupIds } } } } : {}),
        },
      ],
    },
  });
}

export const legalService = {
  // ── Public ──────────────────────────────────────────────────────────────

  /** Published documents, in footer order. */
  async listPublished(): Promise<LegalDocumentLink[]> {
    const rows = await prisma.legalDocument.findMany({
      where: { body: { not: Prisma.AnyNull }, publishedAt: { not: null } },
      select: { key: true, publishedAt: true, requireAcceptance: true },
    });
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return LEGAL_DOCUMENTS
      .filter((k) => byKey.has(k))
      .map((k) => ({ key: k, publishedAt: byKey.get(k)!.publishedAt!.toISOString(), mustAccept: byKey.get(k)!.requireAcceptance }));
  },

  /** Whether joining asks for consent: some published document must be accepted. */
  async consentRequired(): Promise<boolean> {
    return (await this.listPublished()).some((d) => d.mustAccept);
  },

  // ── Acceptance ──────────────────────────────────────────────────────────

  /**
   * What this member still has to accept, in footer order: a published document
   * members must accept that they never have, or whose latest round asks their
   * group (or everyone) and they accepted an older revision.
   */
  async pendingFor(userId: string): Promise<LegalDocumentKey[]> {
    const docs = await requiredDocs();
    if (docs.length === 0) return [];
    const [rows, groups] = await Promise.all([
      prisma.legalAcceptance.findMany({ where: { userId }, select: { documentKey: true, revision: true } }),
      prisma.userGroup.findMany({ where: { userId }, select: { groupId: true } }),
    ]);
    const accepted = new Map(rows.map((r) => [r.documentKey, r.revision]));
    const mine = new Set(groups.map((g) => g.groupId));
    return docs
      .filter((d) => {
        const rev = accepted.get(d.key);
        if (rev === undefined) return true;
        if (rev >= d.revision) return false;
        return d.reacceptGroupIds.length === 0 || d.reacceptGroupIds.some((g) => mine.has(g));
      })
      .map((d) => d.key);
  },

  /**
   * Record acceptance at each document's current revision. `keys` limits it to
   * those (the page a member accepted on); without it, everything they must accept
   * (sign-up). Only published documents members must accept are recorded.
   */
  async accept(userId: string, keys?: LegalDocumentKey[]): Promise<LegalDocumentKey[]> {
    const docs = (await requiredDocs()).filter((d) => !keys || keys.includes(d.key));
    const now = new Date();
    await prisma.$transaction([
      ...docs.map((d) => prisma.legalAcceptance.upsert({
        where: { userId_documentKey: { userId, documentKey: d.key } },
        update: { revision: d.revision, acceptedAt: now },
        create: { userId, documentKey: d.key, revision: d.revision, acceptedAt: now },
      })),
      prisma.user.update({ where: { id: userId }, data: { legalAcceptedAt: now } }),
    ]);
    return this.pendingFor(userId);
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
    return Promise.all(LEGAL_DOCUMENTS.map(async (key) => {
      const r = byKey.get(key);
      const live = !!r && r.body !== null && !!r.publishedAt;
      return {
        key,
        draftBody:   r?.draftBody ?? null,
        body:        r?.body ?? null,
        publishedAt: r?.publishedAt?.toISOString() ?? null,
        updatedAt:   r?.updatedAt.toISOString() ?? null,
        updatedBy:   r?.updatedBy?.username ?? null,
        requireAcceptance: r?.requireAcceptance ?? false,
        revision:          r?.revision ?? 1,
        reacceptGroupIds:  r?.reacceptGroupIds ?? [],
        reacceptedAt:      r?.reacceptedAt?.toISOString() ?? null,
        pendingCount:      live && r.requireAcceptance ? await pendingCount(r) : 0,
      };
    }));
  },

  /** Switch "Must be accepted" on or off. */
  async setRequireAcceptance(key: LegalDocumentKey, requireAcceptance: boolean, userId: string): Promise<void> {
    await prisma.legalDocument.upsert({
      where: { key },
      update: { requireAcceptance, updatedById: userId },
      create: { key, requireAcceptance, updatedById: userId },
    });
  },

  /**
   * Ask members to accept again: a new revision, for these groups (empty = everyone).
   * Only a published document members must accept can be asked for.
   */
  async askAgain(key: LegalDocumentKey, groupIds: string[], userId: string): Promise<void> {
    const row = await prisma.legalDocument.findUnique({ where: { key } });
    if (!row || row.body === null || !row.publishedAt || !row.requireAcceptance) {
      throw new XentiumError({ code: XEC.LEGAL_NOT_ASKABLE, httpStatus: 409, message: "Only a published document members must accept can be asked for again" });
    }
    const known = groupIds.length
      ? (await prisma.group.findMany({ where: { id: { in: groupIds } }, select: { id: true } })).map((g) => g.id)
      : [];
    if (known.length !== new Set(groupIds).size) {
      throw new XentiumError({ code: XEC.API_VALIDATION, httpStatus: 422, message: "Unknown group" });
    }
    await prisma.legalDocument.update({
      where: { key },
      data: { revision: { increment: 1 }, reacceptGroupIds: known, reacceptedAt: new Date(), updatedById: userId },
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

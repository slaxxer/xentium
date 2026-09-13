import { buildPaginationMeta } from "@xentium/contracts";
import { prisma } from "../../infrastructure/db.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O, 0, I, 1 — avoids confusion
  const rand = (n: number) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `NDVO-${rand(4)}-${rand(4)}`;
}

export const inviteService = {
  async list(opts: { page: number; limit: number }) {
    const { page, limit } = opts;
    const [data, total] = await Promise.all([
      prisma.inviteCode.findMany({
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          createdBy:  { select: { id: true, username: true } },
          usedByUser: { select: { id: true, username: true } },
        },
      }),
      prisma.inviteCode.count(),
    ]);
    return { data, meta: buildPaginationMeta({ page, limit, total }) };
  },

  async create(createdById: string, note?: string, expiresAt?: Date | null, maxUses = 1) {
    // Generate a unique code (retry on collision — extremely unlikely)
    let code = generateCode();
    let attempts = 0;
    while (attempts++ < 5) {
      const exists = await prisma.inviteCode.findUnique({ where: { code } });
      if (!exists) break;
      code = generateCode();
    }
    return prisma.inviteCode.create({
      data: { code, note, createdById, expiresAt: expiresAt ?? null, maxUses },
      include: { createdBy: { select: { id: true, username: true } } },
    });
  },

  async revoke(id: string) {
    const code = await prisma.inviteCode.findUnique({ where: { id } });
    if (!code) throw XentiumError.notFound("Invite code not found");
    if (code.useCount > 0) throw XentiumError.conflict("Cannot revoke a code that has already been used");
    await prisma.inviteCode.delete({ where: { id } });
  },

  /** Validate and consume an invite code during registration. Throws XEC-AUTH errors on failure. */
  async consume(code: string, userId: string): Promise<void> {
    const invite = await prisma.inviteCode.findUnique({ where: { code: code.toUpperCase().trim() } });

    if (!invite) {
      throw new XentiumError({ code: "XEC-AUTH-1021", httpStatus: 400, message: "Invalid invite code" });
    }
    if (invite.expiresAt && invite.expiresAt < new Date()) {
      throw new XentiumError({ code: "XEC-AUTH-1021", httpStatus: 400, message: "Invite code has expired" });
    }
    if (invite.useCount >= invite.maxUses) {
      throw new XentiumError({ code: "XEC-AUTH-1021", httpStatus: 400, message: "Invite code has already been used" });
    }

    await prisma.inviteCode.update({
      where: { id: invite.id },
      data: {
        useCount:  { increment: 1 },
        usedById:  invite.maxUses === 1 ? userId : undefined, // only track single-use codes
        usedAt:    invite.maxUses === 1 ? new Date() : undefined,
      },
    });
  },
};

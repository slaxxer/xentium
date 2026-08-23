import { buildPaginationMeta, normalizeBetaPublicRoutes } from "@nodevo/contracts";
import { prisma } from "../../infrastructure/db.js";
import { NodevoError } from "../../shared/errors/NodevoError.js";
import { getSetting } from "../../shared/utils/settings.js";

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const rand = (n: number) =>
    Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `BETA-${rand(4)}-${rand(4)}`;
}

export const betaService = {
  async isEnabled(): Promise<boolean> {
    return Boolean(await getSetting("beta.enabled", false));
  },

  /**
   * Paths that stay reachable while the gate is up.
   *
   * Normalised on every READ, not merely on write. `beta.public_routes` can be
   * set through the generic `PUT /admin/settings/:key`, and a row already in the
   * table predates any validation added later — so the stored value is treated
   * as untrusted input and a reserved path cannot be smuggled in behind the
   * writer's back.
   */
  async getPublicRoutes(): Promise<string[]> {
    const raw = await getSetting<unknown>("beta.public_routes", []);
    return normalizeBetaPublicRoutes(raw).routes;
  },

  /**
   * Check whether a request has valid beta access.
   * Returns { hasAccess: true } immediately when beta mode is off.
   */
  async checkAccess(
    cookieCode: string | false | undefined,
    ip: string,
  ): Promise<{ hasAccess: boolean; necCode?: string; message?: string; details?: Record<string, unknown> }> {
    const enabled = await betaService.isEnabled();
    if (!enabled) return { hasAccess: true };

    if (!cookieCode) {
      return { hasAccess: false, necCode: "NEC-AUTH-1030", message: "Beta access required" };
    }

    // Admin bypass key — no IP lock, always valid
    const adminKey = (await getSetting("beta.admin_key", "")) as string;
    if (adminKey && String(cookieCode) === adminKey) {
      return { hasAccess: true };
    }

    const record = await prisma.betaCode.findUnique({ where: { code: String(cookieCode) } });
    if (!record) {
      return { hasAccess: false, necCode: "NEC-AUTH-1031", message: "Invalid beta code" };
    }
    if (record.redeemerIp && record.redeemerIp !== ip) {
      const registeredUser = record.registeredUserId
        ? await prisma.user.findUnique({ where: { id: record.registeredUserId }, select: { username: true } })
        : null;
      return {
        hasAccess: false,
        necCode:   "NEC-AUTH-1032",
        message:   "Beta access is locked to a different IP address",
        details:   { redeemerIp: record.redeemerIp, registeredUser: registeredUser?.username ?? null },
      };
    }

    return { hasAccess: true };
  },

  /** Validate and lock a beta code to the given IP + UA. Returns whether this is a first-time redeem. */
  async redeem(rawCode: string, ip: string, ua: string): Promise<{ code: string; isNew: boolean }> {
    const code = rawCode.toUpperCase().trim();

    // Admin bypass key — reusable, no IP lock, routes to login not register
    const adminKey = (await getSetting("beta.admin_key", "")) as string;
    if (adminKey && code === adminKey.toUpperCase().trim()) {
      return { code: adminKey, isNew: false };
    }
    const record = await prisma.betaCode.findUnique({ where: { code } });

    if (!record) {
      throw new NodevoError({ code: "NEC-AUTH-1031", httpStatus: 400, message: "Invalid beta code" });
    }
    if (record.redeemerIp && record.redeemerIp !== ip) {
      const registeredUser = record.registeredUserId
        ? await prisma.user.findUnique({ where: { id: record.registeredUserId }, select: { username: true } })
        : null;

      // Log the blocked attempt
      betaService.logEvent({
        eventType: "failed_redeem",
        betaCode:  code,
        username:  registeredUser?.username ?? undefined,
        ip,
        userAgent: ua,
      });

      throw new NodevoError({
        code:       "NEC-AUTH-1032",
        httpStatus: 403,
        message:    "This beta code is locked to a different IP address",
        details: {
          redeemerIp:     record.redeemerIp,
          registeredUser: registeredUser?.username ?? null,
        },
      });
    }

    const isNew = !record.redeemerIp;

    if (isNew) {
      await prisma.betaCode.update({
        where: { id: record.id },
        data: { redeemerIp: ip, redeemerUa: ua, redeemedAt: new Date() },
      });
    }

    return { code, isNew };
  },

  /** Link the beta code to the user who completed registration. */
  async markRegistered(code: string, userId: string): Promise<void> {
    await prisma.betaCode.update({
      where: { code },
      data:  { registeredUserId: userId },
    });
  },

  // ── Activity logging ────────────────────────────────────────────────────────

  async logEvent(opts: {
    eventType: "page_visit" | "login" | "failed_redeem";
    betaCode?: string;
    userId?: string;
    username?: string;
    url?: string;
    ip?: string;
    userAgent?: string;
  }): Promise<void> {
    await prisma.betaAccessLog.create({ data: opts }).catch(() => {
      // Non-fatal — never let logging break the request
    });
  },

  async getLog(opts: { page: number; limit: number }) {
    const { page, limit } = opts;
    const [data, total] = await Promise.all([
      prisma.betaAccessLog.findMany({
        orderBy: { createdAt: "desc" },
        skip:    (page - 1) * limit,
        take:    limit,
      }),
      prisma.betaAccessLog.count(),
    ]);
    return { data, meta: buildPaginationMeta({ page, limit, total }) };
  },

  // ── Admin CRUD ──────────────────────────────────────────────────────────────

  async list(opts: { page: number; limit: number }) {
    const { page, limit } = opts;
    const [data, total] = await Promise.all([
      prisma.betaCode.findMany({
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          createdBy:      { select: { id: true, username: true } },
          registeredUser: { select: { id: true, username: true } },
        },
      }),
      prisma.betaCode.count(),
    ]);
    return { data, meta: buildPaginationMeta({ page, limit, total }) };
  },

  async create(createdById: string, note?: string) {
    let code = generateCode();
    for (let i = 0; i < 5; i++) {
      const exists = await prisma.betaCode.findUnique({ where: { code } });
      if (!exists) break;
      code = generateCode();
    }
    return prisma.betaCode.create({
      data: { code, note, createdById },
      include: { createdBy: { select: { id: true, username: true } } },
    });
  },

  async revoke(id: string) {
    const record = await prisma.betaCode.findUnique({ where: { id } });
    if (!record) throw NodevoError.notFound("Beta code not found");
    await prisma.betaCode.delete({ where: { id } });
  },
};

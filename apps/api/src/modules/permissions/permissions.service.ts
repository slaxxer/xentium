import { prisma } from "../../infrastructure/db.js";

export const permissionsService = {
  async listAll() {
    return prisma.permission.findMany({ orderBy: { key: "asc" } });
  },

  /**
   * True if the user holds `key` through any of their groups. For one-off
   * moderation-override checks inside controllers/services (not middleware);
   * the request-path guards are `requirePermission`/`requireAnyPermission`.
   */
  async userHasPermission(userId: string, key: string): Promise<boolean> {
    const count = await prisma.groupPermission.count({
      where: {
        permission: { key },
        group:      { users: { some: { userId } } },
      },
    });
    return count > 0;
  },

  async listForGroup(groupId: string) {
    const gps = await prisma.groupPermission.findMany({
      where: { groupId },
      include: { permission: true },
    });
    return gps.map((gp) => gp.permission);
  },
};

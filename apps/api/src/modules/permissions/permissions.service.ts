import { prisma } from "../../infrastructure/db.js";

export const permissionsService = {
  async listAll() {
    return prisma.permission.findMany({ orderBy: { key: "asc" } });
  },

  async listForGroup(groupId: string) {
    const gps = await prisma.groupPermission.findMany({
      where: { groupId },
      include: { permission: true },
    });
    return gps.map((gp) => gp.permission);
  },
};

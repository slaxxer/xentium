import path from "node:path";
import { prisma } from "../../infrastructure/db.js";
import { NodevoError } from "../../shared/errors/NodevoError.js";
import { permissionCache } from "../permissions/permission.cache.js";
import { storage } from "../../infrastructure/storage/LocalStorageProvider.js";

// Badge appearance (colour + label + configurable username glow) is edited on the
// group itself (ACP → Groups), so the group list/detail expose the full set.
const BADGE_PROGRESSION_SELECT = {
  badgeColor: true, badgeLabel: true,
  badgeTextShadow: true, badgeShadowColor: true,
  badgeShadowX: true, badgeShadowY: true, badgeShadowBlur: true,
} as const;

export const groupsService = {
  async list() {
    return prisma.group.findMany({
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      include: {
        _count:      { select: { users: true, permissions: true } },
        permissions: { include: { permission: true } },
        progression: { select: BADGE_PROGRESSION_SELECT },
      },
    });
  },

  /** Set badge precedence — lower displayOrder shows first. */
  async reorder(items: { id: string; displayOrder: number }[]) {
    await prisma.$transaction(
      items.map((it) =>
        prisma.group.update({ where: { id: it.id }, data: { displayOrder: it.displayOrder } })),
    );
    return this.list();
  },

  async getById(id: string) {
    const group = await prisma.group.findUnique({
      where: { id },
      include: {
        _count:      { select: { users: true } },
        permissions: { include: { permission: true } },
        progression: { select: BADGE_PROGRESSION_SELECT },
      },
    });
    if (!group) throw NodevoError.notFound("Group not found");
    return group;
  },

  async create(data: { name: string; key: string; showInTeam?: boolean }) {
    const exists = await prisma.group.findUnique({ where: { key: data.key } });
    if (exists) throw NodevoError.conflict("A group with that key already exists");
    return prisma.group.create({
      data: { name: data.name, key: data.key, isSystem: false, showInTeam: data.showInTeam ?? false },
      include: { _count: { select: { users: true, permissions: true } } },
    });
  },

  async update(id: string, data: { name?: string; showInTeam?: boolean }) {
    const group = await prisma.group.findUnique({ where: { id } });
    if (!group) throw NodevoError.notFound("Group not found");
    return prisma.group.update({
      where: { id },
      data: { name: data.name, showInTeam: data.showInTeam },
      include: { _count: { select: { users: true, permissions: true } } },
    });
  },

  async remove(id: string) {
    const group = await prisma.group.findUnique({ where: { id } });
    if (!group) throw NodevoError.notFound("Group not found");
    if (group.isSystem) throw NodevoError.forbidden("Cannot delete a system group");

    // Invalidate caches before the group is deleted (members lose FK access after delete)
    await permissionCache.invalidateForGroup(id);

    const memberGroup = await prisma.group.findFirst({ where: { key: "member" } });
    if (memberGroup) {
      const members = await prisma.userGroup.findMany({ where: { groupId: id } });
      for (const ug of members) {
        await prisma.userGroup.upsert({
          where: { userId_groupId: { userId: ug.userId, groupId: memberGroup.id } },
          update: {},
          create: { userId: ug.userId, groupId: memberGroup.id },
        });
      }
    }
    await prisma.group.delete({ where: { id } });
  },

  async uploadIcon(groupId: string, buffer: Buffer, originalname: string): Promise<string> {
    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw NodevoError.notFound("Group not found");
    const ext      = path.extname(originalname).toLowerCase() || ".png";
    const filename = `${groupId}${ext}`;
    const relPath  = await storage.save("groups", filename, buffer);
    await prisma.group.update({ where: { id: groupId }, data: { icon: relPath } });
    return storage.publicUrl(relPath);
  },

  async setPermissions(groupId: string, permissionKeys: string[]) {
    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw NodevoError.notFound("Group not found");
    const perms = await prisma.permission.findMany({
      where: { key: { in: permissionKeys } },
    });
    await prisma.$transaction(async (tx) => {
      await tx.groupPermission.deleteMany({ where: { groupId } });
      if (perms.length > 0) {
        await tx.groupPermission.createMany({
          data: perms.map((p) => ({ groupId, permissionId: p.id })),
        });
      }
    });
    // Invalidate caches for all members of this group — their effective perms changed
    await permissionCache.invalidateForGroup(groupId);

    return groupsService.getById(groupId);
  },
};

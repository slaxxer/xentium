import { prisma } from "../../infrastructure/db.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { permissionCache } from "../permissions/permission.cache.js";
import { storage } from "../../infrastructure/storage/LocalStorageProvider.js";
import { emitGroupsChanged } from "../../core/events/events.js";

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
    if (!group) throw XentiumError.notFound("Group not found");
    return group;
  },

  async create(data: { name: string; key: string; showInTeam?: boolean }) {
    const exists = await prisma.group.findUnique({ where: { key: data.key } });
    if (exists) throw XentiumError.conflict("A group with that key already exists");
    return prisma.group.create({
      data: { name: data.name, key: data.key, isSystem: false, showInTeam: data.showInTeam ?? false },
      include: { _count: { select: { users: true, permissions: true } } },
    });
  },

  async update(id: string, data: { name?: string; showInTeam?: boolean }) {
    const group = await prisma.group.findUnique({ where: { id } });
    if (!group) throw XentiumError.notFound("Group not found");
    return prisma.group.update({
      where: { id },
      data: { name: data.name, showInTeam: data.showInTeam },
      include: { _count: { select: { users: true, permissions: true } } },
    });
  },

  async remove(id: string) {
    const group = await prisma.group.findUnique({ where: { id } });
    if (!group) throw XentiumError.notFound("Group not found");
    if (group.isSystem) throw XentiumError.forbidden("Cannot delete a system group");

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
    const leaving = await prisma.userGroup.findMany({ where: { groupId: id }, select: { userId: true } });
    await prisma.group.delete({ where: { id } });
    // Every member of a deleted group left it (and may have landed in Member).
    for (const { userId } of leaving) {
      emitGroupsChanged(userId, [id], memberGroup ? [memberGroup.id] : []);
    }
  },

  /**
   * `ext` is the type the upload middleware detected from the bytes — never the
   * client's filename, which says whatever the client likes.
   */
  async uploadIcon(groupId: string, buffer: Buffer, ext: string): Promise<string> {
    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw XentiumError.notFound("Group not found");
    const filename = `${groupId}.${ext.replace(/^\./, "").toLowerCase()}`;
    const relPath  = await storage.save("groups", filename, buffer);
    await prisma.group.update({ where: { id: groupId }, data: { icon: relPath } });
    // A PNG replaced by a WebP is a different file; the old one would linger forever.
    if (group.icon && group.icon !== relPath) await storage.delete(group.icon).catch(() => {});
    return storage.publicUrl(relPath);
  },

  /**
   * The group's rank image, shown instead of its text badge when the site's rank
   * display is "images". Stored beside the icons (`groups/rank-<id>.<ext>`); `ext`
   * is the DETECTED type, as for the icon.
   */
  async uploadRankImage(groupId: string, buffer: Buffer, ext: string): Promise<string> {
    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw XentiumError.notFound("Group not found");
    const filename = `rank-${groupId}.${ext.replace(/^\./, "").toLowerCase()}`;
    const relPath  = await storage.save("groups", filename, buffer);
    await prisma.group.update({ where: { id: groupId }, data: { rankImage: relPath } });
    if (group.rankImage && group.rankImage !== relPath) await storage.delete(group.rankImage).catch(() => {});
    return storage.publicUrl(relPath);
  },

  /** Back to the text badge for this group. Idempotent. */
  async removeRankImage(groupId: string): Promise<void> {
    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw XentiumError.notFound("Group not found");
    if (!group.rankImage) return;
    await prisma.group.update({ where: { id: groupId }, data: { rankImage: null } });
    await storage.delete(group.rankImage).catch(() => {});
  },

  /** Back to the default glyph. Idempotent: a group with no icon is left as it is. */
  async removeIcon(groupId: string): Promise<void> {
    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw XentiumError.notFound("Group not found");
    if (!group.icon) return;
    await prisma.group.update({ where: { id: groupId }, data: { icon: null } });
    await storage.delete(group.icon).catch(() => {});
  },

  /**
   * Grant and revoke individual keys, leaving every other key the group holds
   * alone. What the ACP's group page uses: `setPermissions` replaces the whole
   * set, so a page holding a copy from when it opened would silently revert
   * anything granted since — by another admin, another tab, or a plugin
   * assigning its defaults. A key in both lists is revoked.
   */
  async patchPermissions(groupId: string, grant: string[], revoke: string[]) {
    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw XentiumError.notFound("Group not found");
    const revoking = new Set(revoke);
    const toGrant = await prisma.permission.findMany({ where: { key: { in: grant.filter((k) => !revoking.has(k)) } } });
    const toRevoke = await prisma.permission.findMany({ where: { key: { in: revoke } } });
    await prisma.$transaction(async (tx) => {
      if (toRevoke.length > 0) {
        await tx.groupPermission.deleteMany({ where: { groupId, permissionId: { in: toRevoke.map((p) => p.id) } } });
      }
      if (toGrant.length > 0) {
        await tx.groupPermission.createMany({
          data: toGrant.map((p) => ({ groupId, permissionId: p.id })),
          skipDuplicates: true,
        });
      }
    });
    await permissionCache.invalidateForGroup(groupId);
    return groupsService.getById(groupId);
  },

  async setPermissions(groupId: string, permissionKeys: string[]) {
    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw XentiumError.notFound("Group not found");
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

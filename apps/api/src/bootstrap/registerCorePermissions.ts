import { prisma } from "../infrastructure/db.js";
import { CorePermissions } from "@xentium/contracts";

/**
 * The four system groups, with the precedence (lower = higher rank, decides whose
 * badge a member wears) and badge colour each starts with. Names stay English
 * (group names are site data an admin renames, not core text). The colours tell the
 * staff tiers apart at a glance and are mid-tones that read on light and dark themes.
 */
const GROUPS = [
  { key: "admin",     name: "Administrator", displayOrder: 1, badgeColor: "#d93636" }, // red
  { key: "supermod",  name: "Supermod",      displayOrder: 2, badgeColor: "#e0702a" }, // orange
  { key: "moderator", name: "Moderator",     displayOrder: 3, badgeColor: "#1f9d55" }, // green
  { key: "member",    name: "Member",        displayOrder: 4, badgeColor: "#64748b" }, // grey
];

// Default group grants per §33.
// Admin gets everything; Moderator gets moderation + create/comment but not publish;
// Member gets comment + message only (article authorship is editorial).
const MOD_PERMS = [
  CorePermissions.USER_BAN,
  CorePermissions.USER_MANAGE,
  CorePermissions.ARTICLE_CREATE,
  CorePermissions.ARTICLE_EDIT_OWN,
  CorePermissions.ARTICLE_EDIT_ANY,
  CorePermissions.ARTICLE_DELETE_OWN,
  CorePermissions.ARTICLE_DELETE_ANY,
  CorePermissions.ARTICLE_COMMENT_CREATE,
  CorePermissions.ARTICLE_COMMENT_EDIT_OWN,
  CorePermissions.ARTICLE_COMMENT_DELETE_OWN,
  CorePermissions.ARTICLE_COMMENT_DELETE_ANY,
  CorePermissions.MODERATION_REPORT_FILE,
  CorePermissions.MODERATION_REPORT_MANAGE,
  CorePermissions.MODERATION_WARN_MANAGE,
  CorePermissions.MODERATION_BAN_MANAGE,
  CorePermissions.MODERATION_CASES_MANAGE,
  CorePermissions.MODERATION_LOG_VIEW,
  CorePermissions.MODERATION_SETTINGS,
  CorePermissions.PROFILE_COMMENT_CREATE,
  CorePermissions.PROFILE_COMMENT_DELETE_OWN,
  CorePermissions.PROFILE_COMMENT_DELETE_WALL,
  CorePermissions.PROFILE_COMMENT_DELETE_ANY,
  CorePermissions.BADGE_ASSIGN,
  CorePermissions.MODERATION_PROTECTED,
];

const GRANTS: Record<string, string[]> = {
  admin:    Object.values(CorePermissions),
  supermod: MOD_PERMS,
  moderator: [
    CorePermissions.USER_BAN,
    CorePermissions.ARTICLE_CREATE,
    CorePermissions.ARTICLE_EDIT_OWN,
    CorePermissions.ARTICLE_DELETE_OWN,
    CorePermissions.ARTICLE_DELETE_ANY,
    CorePermissions.ARTICLE_COMMENT_CREATE,
    CorePermissions.ARTICLE_COMMENT_EDIT_OWN,
    CorePermissions.ARTICLE_COMMENT_DELETE_OWN,
    CorePermissions.ARTICLE_COMMENT_DELETE_ANY,
    CorePermissions.MODERATION_REPORT_FILE,
    CorePermissions.MODERATION_REPORT_MANAGE,
    CorePermissions.MODERATION_WARN_MANAGE,
    CorePermissions.MODERATION_BAN_MANAGE,
    CorePermissions.MODERATION_CASES_MANAGE,
    CorePermissions.MODERATION_LOG_VIEW,
    CorePermissions.PROFILE_COMMENT_CREATE,
    CorePermissions.PROFILE_COMMENT_DELETE_OWN,
    CorePermissions.PROFILE_COMMENT_DELETE_WALL,
    CorePermissions.PROFILE_COMMENT_DELETE_ANY,
    CorePermissions.BADGE_ASSIGN,
    CorePermissions.MODERATION_PROTECTED,
  ],
  // Deviation from §33 strict reading: the mockup shows "Write" button to all
  // logged-in users, so Member also gets article authoring on their own content.
  // article.publish stays here so members can publish their own drafts.
  member: [
    CorePermissions.ARTICLE_CREATE,
    CorePermissions.ARTICLE_EDIT_OWN,
    CorePermissions.ARTICLE_DELETE_OWN,
    CorePermissions.ARTICLE_PUBLISH,
    CorePermissions.ARTICLE_COMMENT_CREATE,
    CorePermissions.ARTICLE_COMMENT_EDIT_OWN,
    CorePermissions.ARTICLE_COMMENT_DELETE_OWN,
    CorePermissions.MESSAGE_SEND,
  ],
};

/**
 * Runs on every boot (and once from the installer). It CREATES what is missing and
 * changes nothing that exists:
 *  - a permission's default groups are granted only when that permission is first
 *    created, so a new key reaches existing sites once, and a grant an admin
 *    revoked in ACP → Permissions stays revoked;
 *  - a system group is created if absent, never renamed. Its precedence and badge colour
 *    are set only when the group is created, so an admin's reordering or colour stays.
 * ⚠ Until 2026-10-08 both were upserts that re-applied on every restart, which undid
 * every revocation of a default and every rename of a system group.
 */
export async function registerCorePermissions() {
  const existing = new Set(
    (await prisma.permission.findMany({ select: { key: true } })).map((p) => p.key),
  );
  for (const [key, label] of Object.entries(CorePermissions).map(
    ([k, v]) => [v, k] as const,
  )) {
    await prisma.permission.upsert({
      where: { key },
      update: { label },
      create: { key, label },
    });
  }

  for (const g of GROUPS) {
    let group = await prisma.group.findUnique({ where: { key: g.key } });
    if (!group) {
      group = await prisma.group.create({
        data: {
          key: g.key, name: g.name, isSystem: true, displayOrder: g.displayOrder,
          progression: { create: { badgeColor: g.badgeColor } },
        },
      });
    }

    for (const permKey of GRANTS[g.key] ?? []) {
      if (existing.has(permKey)) continue;
      const perm = await prisma.permission.findUniqueOrThrow({
        where: { key: permKey },
      });
      await prisma.groupPermission.upsert({
        where: {
          groupId_permissionId: { groupId: group.id, permissionId: perm.id },
        },
        update: {},
        create: { groupId: group.id, permissionId: perm.id },
      });
    }
  }
}

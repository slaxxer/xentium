import { prisma } from "../infrastructure/db.js";
import { CorePermissions } from "@xentium/contracts";

const GROUPS = [
  { key: "admin",     name: "Administrator" },
  { key: "supermod",  name: "Supermod"      },
  { key: "moderator", name: "Moderator"     },
  { key: "member",    name: "Member"        },
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
 *  - a system group is created if absent, never renamed.
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
    const group = await prisma.group.upsert({
      where: { key: g.key },
      update: {},
      create: { key: g.key, name: g.name, isSystem: true },
    });

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

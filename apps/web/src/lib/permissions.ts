import { permissionLabel } from "./coreText";

export interface Permission {
  id: string;
  key: string;
  label: string;
  domain: string;
}

// One row per core permission, in the order ACP → Permissions lists them: a section
// first (DOMAIN_ORDER), then the rows of that section top to bottom.
//  - Administration: everything that only works inside the admin panel.
//  - Moderation: acting on other members and their content.
//  - Members, Articles, Comments, Messaging: what members do on the site.
const PERM_META: Record<string, { label: string; domain: string }> = {
  "admin.access":               { label: "Access the admin panel",             domain: "Administration" },
  "group.manage":               { label: "Manage groups & permissions",        domain: "Administration" },
  "user.manage":                { label: "Manage user accounts",               domain: "Administration" },
  "user.ban":                   { label: "Ban users",                          domain: "Administration" },
  "progression.manage":         { label: "Manage the progression system",      domain: "Administration" },
  "badge.manage":               { label: "Edit the badge catalogue",           domain: "Administration" },
  "legal.manage":               { label: "Manage legal documents",             domain: "Administration" },
  "emoji.manage":               { label: "Manage custom emojis",               domain: "Administration" },
  "moderation.settings":        { label: "Change moderation settings",         domain: "Administration" },
  "admin.plugins":              { label: "Manage plugins in the admin panel",  domain: "Administration" },
  "plugin.install":             { label: "Install plugins",                    domain: "Administration" },
  "plugin.enable":              { label: "Enable & disable plugins",           domain: "Administration" },
  "system.tasks.manage":        { label: "Manage scheduled tasks",             domain: "Administration" },
  "system.update":              { label: "Update Xentium from the ACP",        domain: "Administration" },

  "moderation.report.manage":   { label: "Handle reports",                     domain: "Moderation" },
  "moderation.cases.manage":    { label: "Work review cases",                  domain: "Moderation" },
  "moderation.warn.manage":     { label: "Warn members",                       domain: "Moderation" },
  "moderation.warn.expiry.override": { label: "Change how long a warning counts", domain: "Moderation" },
  "moderation.ban.manage":      { label: "Ban and unban members",              domain: "Moderation" },
  "moderation.ban.length.override":  { label: "Change how long a ban lasts",     domain: "Moderation" },
  "moderation.log.view":        { label: "View the moderation log",            domain: "Moderation" },
  "moderation.protected":       { label: "Counts as staff (cannot be warned or banned)", domain: "Moderation" },
  "article.hide":               { label: "Hide articles and see hidden ones",  domain: "Moderation" },
  "article.comments.close":     { label: "Close and reopen article comments",  domain: "Moderation" },
  "article.comment.closed":     { label: "Comment where comments are closed",  domain: "Moderation" },
  "article.comment.delete.any": { label: "Delete anyone's article comments",   domain: "Moderation" },
  "profile.comment.delete.any": { label: "Delete anyone's wall posts",         domain: "Moderation" },
  "badge.assign":               { label: "Award badges to members",            domain: "Moderation" },

  "account.twofactor.required": { label: "Must use two-factor sign-in",        domain: "Members" },
  "moderation.report.file":     { label: "Report content",                     domain: "Members" },
  "profile.comment.create":     { label: "Post on profile walls",              domain: "Members" },
  "profile.comment.delete.own": { label: "Delete own wall posts",              domain: "Members" },
  "profile.comment.delete.wall":{ label: "Delete posts on own wall",           domain: "Members" },

  "article.create":             { label: "Write articles",                     domain: "Articles" },
  "article.edit.own":           { label: "Edit own articles",                  domain: "Articles" },
  "article.edit.any":           { label: "Edit anyone's articles",             domain: "Articles" },
  "article.publish":            { label: "Publish articles",                   domain: "Articles" },
  "article.delete.own":         { label: "Delete own articles",                domain: "Articles" },
  "article.delete.any":         { label: "Delete anyone's articles",           domain: "Articles" },
  "article.revisions.view":     { label: "View article revision history",      domain: "Articles" },
  "article.revisions.restore":  { label: "Restore previous article versions",  domain: "Articles" },

  "article.comment.create":     { label: "Post comments on articles",          domain: "Comments" },
  "article.comment.edit.own":   { label: "Edit own article comments",          domain: "Comments" },
  "article.comment.delete.own": { label: "Delete own article comments",        domain: "Comments" },

  "message.send":               { label: "Send private messages",              domain: "Messaging" },
};

/** Core sections first, in this order; add-on sections (named by their key prefix) follow A–Z. */
export const DOMAIN_ORDER = [
  "Administration",
  "Moderation",
  "Members",
  "Articles",
  "Comments",
  "Messaging",
];

/** A core permission's place within its section; add-on rows keep their own order after these. */
const ROW_ORDER = new Map(Object.keys(PERM_META).map((k, i) => [k, i]));

export function enrichPerm(p: Permission): Permission {
  const meta = PERM_META[p.key];
  // `domain` stays the English grouping key; show it through permissionDomainLabel.
  if (meta) return { ...p, label: permissionLabel(p.key, meta.label), domain: meta.domain };
  const prefix = p.key.split(".")[0] ?? "other";
  const domain = prefix.charAt(0).toUpperCase() + prefix.slice(1);
  // A plugin registers a real label ("Reply to closed threads"); core keys store
  // their constant name (ADMIN_ACCESS) and all have PERM_META above.
  const label  = p.label && /[a-z]/.test(p.label)
    ? p.label
    : p.key.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return { ...p, label: permissionLabel(p.key, label), domain };
}

export function groupByDomain(permissions: Permission[]): [string, Permission[]][] {
  const map: Record<string, Permission[]> = {};
  for (const p of permissions.map(enrichPerm)) {
    (map[p.domain] ??= []).push(p);
  }
  return Object.keys(map)
    .sort((a, b) => {
      const ai = DOMAIN_ORDER.indexOf(a);
      const bi = DOMAIN_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    })
    .map((d) => [d, [...map[d]!].sort((a, b) => (ROW_ORDER.get(a.key) ?? 999) - (ROW_ORDER.get(b.key) ?? 999))] as [string, Permission[]]);
}

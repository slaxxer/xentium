export interface Permission {
  id: string;
  key: string;
  label: string;
  domain: string;
}

const PERM_META: Record<string, { label: string; domain: string }> = {
  "admin.access":               { label: "Access the admin panel",             domain: "Administration" },
  "user.manage":                { label: "Manage user accounts",               domain: "Users" },
  "user.ban":                   { label: "Ban users",                          domain: "Users" },
  "group.manage":               { label: "Manage groups & permissions",        domain: "Users" },
  "progression.manage":         { label: "Manage the progression system",      domain: "Users" },
  "article.create":             { label: "Write articles",                     domain: "Articles" },
  "article.edit.own":           { label: "Edit own articles",                  domain: "Articles" },
  "article.edit.any":           { label: "Edit anyone's articles",             domain: "Articles" },
  "article.publish":            { label: "Publish articles",                   domain: "Articles" },
  "article.delete.own":         { label: "Delete own articles",                domain: "Articles" },
  "article.delete.any":         { label: "Delete anyone's articles",           domain: "Articles" },
  "article.comment.create":     { label: "Post comments on articles",          domain: "Articles" },
  "article.comment.edit.own":   { label: "Edit own article comments",          domain: "Articles" },
  "article.comment.delete.own": { label: "Delete own article comments",        domain: "Articles" },
  "article.comment.delete.any": { label: "Delete anyone's article comments",   domain: "Articles" },
  "article.revisions.view":     { label: "View article revision history",      domain: "Articles" },
  "article.revisions.restore":  { label: "Restore previous article versions",  domain: "Articles" },
  "message.send":               { label: "Send private messages",              domain: "Messaging" },
  "plugin.install":             { label: "Install plugins",                    domain: "Extensions" },
  "plugin.enable":              { label: "Enable & disable plugins",           domain: "Extensions" },
};

export const DOMAIN_ORDER = [
  "Administration",
  "Users",
  "Articles",
  "Messaging",
  "Extensions",
];

export function enrichPerm(p: Permission): Permission {
  const meta = PERM_META[p.key];
  if (meta) return { ...p, label: meta.label, domain: meta.domain };
  const prefix = p.key.split(".")[0] ?? "other";
  const domain = prefix.charAt(0).toUpperCase() + prefix.slice(1);
  const label  = p.key.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return { ...p, label, domain };
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
    .map((d) => [d, map[d]!] as [string, Permission[]]);
}

import type { ExactRedirect, RedirectSpec } from "@xentium/migrate-core";
import type { Connection } from "mysql2/promise";

const B = String.raw`^/(?:[^?]*/)?`;
/** `?t=12`, `?12-title` or `/12-title` after a vBulletin 3/4 script. */
const script = (name: string, arg: string) => String.raw`${B}${name}\.php(?:\?(?:[^#]*[&;])?${arg}=|\?|/)(?<id>\d+)`;
/** vBulletin 4's friendly URLs: threads/12-title, forums/3-name, members/5-name. */
const friendly = (dir: string) => String.raw`${B}${dir}/(?<id>\d+)(?:[-/?]|$)`;

/** vBulletin 3 and 4: showthread.php, showpost.php, forumdisplay.php, member.php and the friendly forms. */
export const classicRedirects: RedirectSpec = {
  patterns: [
    { entity: "post", regex: String.raw`${B}(?:showthread\.php|showpost\.php|threads/\d+)[^#]*[?&;]p=(?<id>\d+)` },
    { entity: "thread", regex: script("showthread", "t") },
    { entity: "thread", regex: friendly("threads") },
    { entity: "forum_node", regex: script("forumdisplay", "f") },
    { entity: "forum_node", regex: friendly("forums") },
    { entity: "user", regex: script("member", "u") },
    { entity: "user", regex: friendly("members") },
  ],
};

/**
 * vBulletin 5 and 6: a topic is `/<channel path>/<nodeid>-<title>`, a reply adds
 * `?p=<nodeid>`, a member is `/member/<id>-<name>`. Channels carry no id in their
 * address, so they come from vBulletin's route table as exact paths.
 * A topic sits at least two levels deep (forum/<channel>/), which with the excluded
 * prefixes keeps the pattern off our own addresses (/forum/<slug>, /forum/thread/…).
 */
export async function nodeRedirects(conn: Connection, prefix: string): Promise<RedirectSpec> {
  const exact: ExactRedirect[] = [];
  try {
    const [rows] = await conn.query(`SELECT prefix, contentid FROM ${prefix}routenew WHERE class = 'vB5_Route_Channel' AND contentid > 0`);
    for (const r of rows as Array<{ prefix: string; contentid: number }>) {
      const path = `/${String(r.prefix).replace(/^\/+|\/+$/g, "")}`;
      if (path === "/") continue;
      exact.push({ entity: "forum_node", path, sourceId: String(r.contentid) });
      exact.push({ entity: "forum_node", path: `${path}/`, sourceId: String(r.contentid) });
    }
  } catch { /* no route table: channels just get no redirect */ }
  return {
    patterns: [
      { entity: "post", regex: String.raw`^/(?!forum/thread/|u/|articles/|member/)(?:[^/?]+/){2,}\d+-[^?]*\?(?:[^#]*[&;])?p=(?<id>\d+)` },
      { entity: "thread", regex: String.raw`^/(?!forum/thread/|u/|articles/|member/)(?:[^/?]+/){2,}(?<id>\d+)-[^/?]*(?:/page\d+)?/?(?:\?|$)` },
      { entity: "user", regex: String.raw`^/(?:[^?]*/)?member/(?<id>\d+)(?:[-/?]|$)` },
    ],
    exact,
  };
}

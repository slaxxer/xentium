import type { AdapterSource, ExtractResult, MigrateAdapter, MigrationInspection, MigrationReporter } from "@xentium/migrate-core";
import { connect, detectLayout, extractVbulletin, forumRootId, vbVersion } from "./extract.js";
import { classicRedirects, nodeRedirects } from "./redirects.js";

const DEFAULT_PREFIX = "";

/**
 * vBulletin 3, 4, 5 and 6 → Xentium. Direct MySQL source; the layout (classic
 * tables or the vB5/6 node tree) is detected. The xentium-forum plugin must be
 * enabled on the target: a forum without the forum plugin has nowhere to go.
 */
export const vbulletinAdapter: MigrateAdapter = {
  name: "vbulletin",
  version: "1.0.0-alpha.0",
  requiredPlugins: ["xentium-forum"],

  async inspect(source: AdapterSource): Promise<MigrationInspection> {
    if (!source.db) {
      return {
        platform: "vBulletin",
        counts: {},
        warnings: [],
        preconditions: { met: [], missing: ["--source-db mysql://user:pass@host/vbulletin_db"] },
      };
    }
    const p = source.tablePrefix ?? DEFAULT_PREFIX;
    const conn = await connect({ db: source.db, tablePrefix: p });
    const count = async (sql: string, params: unknown[] = []) => {
      const [r] = await conn.query(sql, params);
      return Number((r as Array<{ n: number }>)[0]?.n ?? 0);
    };
    try {
      const layout = await detectLayout(conn, p);
      if (!layout) {
        return {
          platform: "vBulletin",
          counts: {},
          warnings: [],
          preconditions: { met: ["Source DB connected"], missing: [`vBulletin tables${p ? ` with the prefix "${p}"` : ""} (check --prefix)`] },
        };
      }
      const version = await vbVersion(conn, p);
      const missing: string[] = [];
      let counts: Record<string, number>;
      if (layout === "classic") {
        counts = {
          users:   await count(`SELECT COUNT(*) n FROM ${p}user`),
          forums:  await count(`SELECT COUNT(*) n FROM ${p}forum WHERE link = '' OR link IS NULL`),
          threads: await count(`SELECT COUNT(*) n FROM ${p}thread WHERE visible = 1 AND open <> 10`),
          posts:   await count(`SELECT COUNT(*) n FROM ${p}post WHERE visible = 1`),
        };
      } else {
        const root = await forumRootId(conn, p);
        if (root == null) missing.push("the Forum channel (none with vBulletin's stock GUID or the title \"Forum\")");
        counts = {
          users:    await count(`SELECT COUNT(*) n FROM ${p}user`),
          channels: root == null ? 0 : await count(
            `SELECT COUNT(*) n FROM ${p}closure cl JOIN ${p}channel c ON c.nodeid = cl.child WHERE cl.parent = ? AND cl.depth > 0`, [root]),
          topics:   root == null ? 0 : await count(
            `SELECT COUNT(*) n FROM ${p}node n JOIN ${p}closure cl ON cl.child = n.parentid AND cl.parent = ?
              WHERE n.starter = n.nodeid AND n.showpublished = 1 AND n.showapproved = 1`, [root]),
        };
      }
      const warnings = [
        "vBulletin's per-forum permissions can't be represented in Xentium's flat groups: Administrators map to Administrator, Super Moderators and Moderators to Moderator, everyone else to Member (stock group ids 6, 5 and 7).",
        "Members keep their passwords (checked on first login, then upgraded to argon2).",
        "Posts by guests are skipped: Xentium posts need an account. Threads started by a guest are skipped with their replies.",
        "Private messages become conversations when the xentium-messaging plugin is enabled on the target (otherwise they're counted and skipped); vB3/4 reply chains are regrouped into conversations.",
        "Attachments, blogs, groups, polls and reputation points are not migrated. Attachments leave an [attachment] marker; videos become links.",
        layout === "classic"
          ? "vBulletin 3/4 has no likes in core and its buddy list is private, so only ignore lists carry over (as blocks)."
          : "Positive reputation on a post becomes a like; member follows carry over 1:1 and ignores become blocks.",
        "Older boards on a latin1 database may show broken accents; convert the database to utf8mb4 first if yours does.",
      ];
      return {
        platform: `vBulletin ${version} (${layout === "nodes" ? "5/6" : "3/4"})`,
        counts,
        warnings,
        preconditions: { met: [`Source DB connected (vBulletin ${version})`], missing },
      };
    } finally {
      await conn.end();
    }
  },

  async extract(source: AdapterSource, reporter: MigrationReporter): Promise<ExtractResult> {
    if (!source.db) throw new Error("vBulletin adapter needs --source-db mysql://…");
    return extractVbulletin({ db: source.db, tablePrefix: source.tablePrefix ?? DEFAULT_PREFIX, filesDir: source.filesDir }, reporter);
  },

  async redirects(source: AdapterSource) {
    if (!source.db) throw new Error("vBulletin adapter needs --source-db mysql://…");
    const p = source.tablePrefix ?? DEFAULT_PREFIX;
    const conn = await connect({ db: source.db, tablePrefix: p });
    try {
      return (await detectLayout(conn, p)) === "nodes" ? await nodeRedirects(conn, p) : classicRedirects;
    } finally {
      await conn.end();
    }
  },
};

export { vbBbcodeToHtml, escapeLikeVb, unescapeVb } from "./bbcode.js";
export { passwordOf } from "./mapping.js";
export default vbulletinAdapter;

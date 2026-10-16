import type { AdapterSource, ExtractResult, MigrateAdapter, MigrationInspection, MigrationReporter } from "@xentium/migrate-core";
import { connect, extractWoltlab, hasTable, versions } from "./extract.js";
import { prefixesOf } from "./mapping.js";
import { woltlabRedirects } from "./redirects.js";

/**
 * WoltLab Suite → Xentium: members, articles and (with Burning Board) the forum.
 * Direct MySQL source. `--prefix` names the instance ("1", "wcf1_"); the default is 1.
 * The xentium-forum plugin must be enabled on the target.
 */
export const woltlabAdapter: MigrateAdapter = {
  name: "woltlab",
  version: "1.0.0-alpha.0",
  requiredPlugins: ["xentium-forum"],

  async inspect(source: AdapterSource): Promise<MigrationInspection> {
    if (!source.db) {
      return {
        platform: "WoltLab Suite",
        counts: {},
        warnings: [],
        preconditions: { met: [], missing: ["--source-db mysql://user:pass@host/woltlab_db"] },
      };
    }
    const { wcf, wbb, n } = prefixesOf(source.tablePrefix);
    const conn = await connect(source.db);
    const count = async (sql: string) => {
      const [r] = await conn.query(sql);
      return Number((r as Array<{ n: number }>)[0]?.n ?? 0);
    };
    try {
      if (!(await hasTable(conn, `${wcf}user`))) {
        return {
          platform: "WoltLab Suite",
          counts: {},
          warnings: [],
          preconditions: { met: ["Source DB connected"], missing: [`WoltLab tables for instance ${n} (${wcf}…); check --prefix`] },
        };
      }
      const v = await versions(conn, { db: source.db, wcf, wbb });
      const forum = await hasTable(conn, `${wbb}board`);
      const counts: Record<string, number> = { users: await count(`SELECT COUNT(*) n FROM ${wcf}user`) };
      if (await hasTable(conn, `${wcf}article`)) counts.articles = await count(`SELECT COUNT(*) n FROM ${wcf}article`);
      if (forum) {
        counts.boards = await count(`SELECT COUNT(*) n FROM ${wbb}board WHERE boardType IN (0, 1)`);
        counts.threads = await count(`SELECT COUNT(*) n FROM ${wbb}thread`);
        counts.posts = await count(`SELECT COUNT(*) n FROM ${wbb}post`);
      }
      return {
        platform: `WoltLab Suite ${v.wcf}${v.wbb ? ` with Burning Board ${v.wbb}` : ""}`,
        counts,
        warnings: [
          "Staff are found by group permission: groups that can use the admin panel map to Administrator, groups that can moderate to Moderator, everyone else to Member.",
          "Members keep their passwords (WoltLab's bcrypt, its older double bcrypt and WCF 1 hashes; checked on first login, then upgraded to argon2). Hashes WoltLab kept from an earlier migration reset once.",
          "Posts and threads by guests are skipped: Xentium posts need an account.",
          "Conversations become private conversations when the xentium-messaging plugin is enabled on the target (otherwise they're counted and skipped). Hidden ones arrive archived; drafts stay out.",
          "Attachments, the gallery, calendar, filebase, blog and comments are not migrated. Attachments leave an [attachment] marker; media embeds become links.",
          "Reactions on posts become likes; follows carry over 1:1 and ignores become blocks. Multilingual articles come over in one language (the default).",
          ...(forum ? [] : ["No Burning Board found: only members and articles will be imported."]),
        ],
        preconditions: { met: [`Source DB connected (WoltLab Suite ${v.wcf}, instance ${n})`], missing: [] },
      };
    } finally {
      await conn.end();
    }
  },

  async extract(source: AdapterSource, reporter: MigrationReporter): Promise<ExtractResult> {
    if (!source.db) throw new Error("WoltLab adapter needs --source-db mysql://…");
    const { wcf, wbb } = prefixesOf(source.tablePrefix);
    return extractWoltlab({ db: source.db, wcf, wbb, filesDir: source.filesDir }, reporter);
  },

  async redirects() {
    return woltlabRedirects;
  },
};

export { woltlabMessageToHtml, woltlabHtmlToHtml, wcfBbcodeToHtml } from "./message.js";
export { passwordOf, prefixesOf } from "./mapping.js";
export default woltlabAdapter;

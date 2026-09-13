import mysql from "mysql2/promise";
import type { AdapterSource, ExtractResult, MigrateAdapter, MigrationInspection, MigrationReporter } from "@nodevo/migrate-core";
import { extractPhpbb, phpbbVersion } from "./extract.js";

const DEFAULT_PREFIX = "phpbb_";

/**
 * phpBB → Xentium adapter (§34, Wave 1). Source is a direct MySQL connection
 * to the phpBB database; the target must have the nodevo-forum plugin
 * installed AND enabled — a forum board without the forum plugin would be a
 * member list with no content, so the run refuses outright.
 */
export const phpbbAdapter: MigrateAdapter = {
  name: "phpbb",
  version: "1.0.0-alpha.0",
  requiredPlugins: ["nodevo-forum"],

  async inspect(source: AdapterSource): Promise<MigrationInspection> {
    if (!source.db) {
      return {
        platform: "phpBB",
        counts: {},
        warnings: [],
        preconditions: { met: [], missing: ["--source-db mysql://user:pass@host/phpbb_db"] },
      };
    }
    const prefix = source.tablePrefix ?? DEFAULT_PREFIX;
    const version = await phpbbVersion({ db: source.db, tablePrefix: prefix });

    const conn = await mysql.createConnection({ uri: source.db, charset: "utf8mb4" });
    const count = async (sql: string): Promise<number> => {
      const [rows] = await conn.query(sql);
      return Number((rows as Array<{ n: number }>)[0]?.n ?? 0);
    };
    try {
      const counts = {
        users:   await count(`SELECT COUNT(*) n FROM ${prefix}users WHERE user_type <> 2`),
        forums:  await count(`SELECT COUNT(*) n FROM ${prefix}forums WHERE forum_type <> 2`),
        threads: await count(`SELECT COUNT(*) n FROM ${prefix}topics WHERE topic_visibility = 1`),
        posts:   await count(`SELECT COUNT(*) n FROM ${prefix}posts WHERE post_visibility = 1`),
      };
      const warnings = [
        "phpBB's per-forum permission overrides cannot be represented in Xentium's flat RBAC — founders map to Administrator, global moderators to Moderator, everyone else to Member (§34, lossy by design).",
        "Users keep their passwords: phpBB bcrypt/phpass hashes are verified on first login and upgraded to argon2.",
        "Attachments, private messages and per-forum moderators are not migrated in this version.",
        "phpBB has no post likes or follows. Zebra foes become blocks; the friend flag is a private buddy list and is deliberately not converted into public follows.",
      ];
      const missing: string[] = [];
      if (/^[0-2]\./.test(version) && !version.startsWith("3.")) {
        missing.push(`phpBB 3.1+ required (detected ${version}) — upgrade the board first`);
      } else if (version.startsWith("3.0")) {
        missing.push(`phpBB 3.1+ required (detected ${version}, which predates visibility columns) — upgrade the board first`);
      }
      return {
        platform: `phpBB ${version}`,
        counts,
        warnings,
        preconditions: { met: [`Source DB connected (phpBB ${version})`], missing },
      };
    } finally {
      await conn.end();
    }
  },

  async extract(source: AdapterSource, reporter: MigrationReporter): Promise<ExtractResult> {
    if (!source.db) throw new Error("phpBB adapter needs --source-db mysql://…");
    return extractPhpbb({ db: source.db, tablePrefix: source.tablePrefix ?? DEFAULT_PREFIX }, reporter);
  },
};

export { convertPostText } from "./postText.js";
export default phpbbAdapter;

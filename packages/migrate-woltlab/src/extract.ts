import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import {
  attachLastSeen, birthdayOf, htmlToText, keyset, toneOfClass, type ImportedPrefix,
  type ExtractResult, type ImportError, type ImportedArticle, type ImportedBan, type ImportedBlock, type ImportedCategory,
  type ImportedComment, type ImportedConversation, type ImportedFollow, type ImportedForumNode, type ImportedMessage,
  type ImportedPost, type ImportedPostLike, type ImportedProfileComment, type ImportedSubscription, type ImportedThread,
  type ImportedGroup, type ImportedUser, type MigrationReporter, type Rows,
} from "@xentium/migrate-core";
import { woltlabMessageToHtml } from "./message.js";
import { boardKind, isLanguageKey, passwordOf, postSkipReason, threadSkipReason, type WbbThreadFlags } from "./mapping.js";

/**
 * WoltLab Suite extractor. The core (WCF, `wcf1_`) is open source, so its tables are
 * known exactly. The forum (Burning Board, `wbb1_`) isn't public; we read the columns
 * every version has and check for the optional ones (sticky, disabled, deleted,
 * views, moved) before using them, so a version without one still imports.
 */

export interface WoltlabSource { db: string; wcf: string; wbb: string; /** The WoltLab Suite folder (where images/ and _data/ are). */ filesDir?: string }

type Conn = mysql.Connection;
// Raw MySQL rows: the columns are read by name right where they are used.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

async function q<T = Row>(conn: Conn, sql: string, params: unknown[] = []): Promise<T[]> {
  const [r] = await conn.query(sql, params);
  return r as T[];
}
async function optional<T = Row>(conn: Conn, sql: string, params: unknown[], onMissing: () => void): Promise<T[]> {
  try { return await q<T>(conn, sql, params); } catch { onMissing(); return []; }
}

export async function connect(db: string): Promise<Conn> {
  return mysql.createConnection({ uri: db, charset: "utf8mb4" });
}

export async function hasTable(conn: Conn, table: string): Promise<boolean> {
  return (await q(conn, "SHOW TABLES LIKE ?", [table])).length > 0;
}

async function columns(conn: Conn, table: string): Promise<Set<string>> {
  return new Set((await q<{ Field: string }>(conn, `SHOW COLUMNS FROM ${table}`)).map((c) => c.Field));
}

const ucolsAvatar = (cols: Set<string>) => cols.has("avatarFileID");

/** "col" when the table has it, else a neutral constant under the same name. */
const pick = (cols: Set<string>, name: string, fallback: string) => (cols.has(name) ? name : `${fallback} AS ${name}`);

export async function versions(conn: Conn, s: WoltlabSource): Promise<{ wcf: string; wbb: string | null }> {
  const rows = await optional<{ package: string; packageVersion: string }>(conn,
    `SELECT package, packageVersion FROM ${s.wcf}package WHERE package IN ('com.woltlab.wcf', 'com.woltlab.wbb')`, [], () => undefined);
  return {
    wcf: rows.find((r) => r.package === "com.woltlab.wcf")?.packageVersion ?? "unknown",
    wbb: rows.find((r) => r.package === "com.woltlab.wbb")?.packageVersion ?? null,
  };
}

/** Resolves language keys (multilingual sites store "wbb.board.board3.title") in the default language. */
async function languageResolver(conn: Conn, s: WoltlabSource): Promise<(text: string) => string> {
  const items = await optional<{ languageItem: string; languageItemValue: string }>(conn,
    `SELECT li.languageItem, li.languageItemValue FROM ${s.wcf}language_item li
       JOIN ${s.wcf}language l ON l.languageID = li.languageID AND l.isDefault = 1
      WHERE li.languageItem LIKE 'wbb.board.%' OR li.languageItem LIKE 'wcf.category.%' OR li.languageItem LIKE 'wcf.acp.group.%' OR li.languageItem LIKE 'wcf.acp.label.%'`,
    [], () => undefined);
  const map = new Map(items.map((i) => [i.languageItem, i.languageItemValue]));
  return (text: string) => (isLanguageKey(text) ? map.get(text) ?? text : text);
}

async function groupRoles(conn: Conn, s: WoltlabSource, reporter: MigrationReporter): Promise<{ admin: Set<number>; mod: Set<number> }> {
  // Who counts as staff is a group permission in WoltLab, not a fixed group id.
  const byOption = async (option: string) => new Set((await q<{ groupID: number }>(conn,
    `SELECT v.groupID FROM ${s.wcf}user_group_option_value v
       JOIN ${s.wcf}user_group_option o ON o.optionID = v.optionID
      WHERE o.optionName = ? AND v.optionValue = '1'`, [option])).map((r) => r.groupID));
  try {
    return { admin: await byOption("admin.general.canUseAcp"), mod: await byOption("mod.general.canUseModeration") };
  } catch {
    reporter.warn("Group permissions not readable: using WoltLab's stock groups (4 = Administrators, 5 = Moderators).");
    return { admin: new Set([4]), mod: new Set([5]) };
  }
}

export async function extractWoltlab(s: WoltlabSource, reporter: MigrationReporter): Promise<ExtractResult> {
  const conn = await connect(s.db);
  const skipped: ImportError[] = [];
  try {
    const v = await versions(conn, s);
    reporter.info(`Source: WoltLab Suite ${v.wcf}${v.wbb ? `, Burning Board ${v.wbb}` : ""}`);
    const t = await languageResolver(conn, s);

    // ── users ────────────────────────────────────────────────────────────────
    const roles = await groupRoles(conn, s, reporter);
    const memberships = new Map<number, number[]>();
    for (const r of await q<{ userID: number; groupID: number }>(conn, `SELECT userID, groupID FROM ${s.wcf}user_to_group`)) {
      memberships.set(r.userID, [...(memberships.get(r.userID) ?? []), r.groupID]);
    }
    const users: ImportedUser[] = [];
    let resets = 0;
    for (const r of await q(conn, `SELECT userID, username, email, password, registrationDate FROM ${s.wcf}user`)) {
      if (!r.email || !r.username) {
        skipped.push({ entity: "user", sourceId: String(r.userID), reason: "missing email or username" });
        continue;
      }
      const groups = memberships.get(r.userID) ?? [];
      const pw = passwordOf(r.password);
      if (!pw.passwordHash) resets++;
      users.push({
        sourceId: String(r.userID),
        email: r.email,
        username: r.username,
        ...pw,
        role: groups.some((g) => roles.admin.has(g)) ? "admin" : groups.some((g) => roles.mod.has(g)) ? "moderator" : undefined,
        joinedAt: r.registrationDate ? new Date(r.registrationDate * 1000) : undefined,
      });
    }
    if (resets) reporter.warn(`${resets} member(s) have a password format we can't carry; they reset it once.`);
    // Last visit (lastActivityTime; 0 = never).
    attachLastSeen(users, await optional<{ id: number; at: number }>(conn,
      `SELECT userID AS id, lastActivityTime AS at FROM ${s.wcf}user`, [], () => undefined));

    // Member groups: WoltLab's own groups (everyone, guests, users, owner) have a
    // groupType below 4 or above it; custom ones are 4. Staff groups map to roles.
    const groups: ImportedGroup[] = (await optional<{ groupID: number; groupName: string }>(conn,
      `SELECT groupID, groupName FROM ${s.wcf}user_group WHERE groupType = 4`, [],
      () => reporter.warn("Member groups not readable: only staff and members are told apart.")))
      .filter((g) => !roles.admin.has(g.groupID) && !roles.mod.has(g.groupID))
      .map((g) => ({ sourceId: String(g.groupID), name: isLanguageKey(t(g.groupName)) ? `Group ${g.groupID}` : t(g.groupName) }));
    const groupIds = new Set(groups.map((g) => Number(g.sourceId)));
    for (const u of users) {
      u.groupSourceIds = (memberships.get(Number(u.sourceId)) ?? []).filter((g) => groupIds.has(g)).map(String);
    }

    // Personal info: WoltLab keeps profile options in wcf1_user_option_value, one
    // column per option ("userOption<id>"). Birthday is "YYYY-MM-DD" (year 0000 = hidden).
    const opts = await optional<{ optionID: number; optionName: string }>(conn,
      `SELECT optionID, optionName FROM ${s.wcf}user_option WHERE optionName IN ('birthday', 'homepage')`, [], () => undefined);
    const col = (name: string) => opts.find((o) => o.optionName === name);
    if (opts.length) {
      const cols = opts.map((o) => `userOption${o.optionID}`).join(", ");
      const vals = await optional(conn, `SELECT userID, ${cols} FROM ${s.wcf}user_option_value`, [], () => undefined);
      const byId = new Map(vals.map((r) => [String(r.userID), r]));
      for (const u of users) {
        const r = byId.get(u.sourceId);
        if (!r) continue;
        const b = col("birthday") ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(r[`userOption${col("birthday")!.optionID}`] ?? "")) : null;
        if (b) u.birthday = birthdayOf(Number(b[1]), Number(b[2]), Number(b[3]));
        const h = col("homepage") ? String(r[`userOption${col("homepage")!.optionID}`] ?? "") : "";
        if (h) u.website = h;
      }
    }

    // Avatars. Up to 6.0: wcf1_user_avatar, file images/avatars/<hash[0..2]>/<avatarID>-<hash>.<ext>.
    // From 6.1: wcf1_user.avatarFileID → wcf1_file, file _data/public/files/<hash[0..2]>/<hash[2..4]>/<fileID>-<hash>.<ext>.
    {
      const files = new Map<string, string>();
      if (ucolsAvatar(await columns(conn, `${s.wcf}user`)) && await hasTable(conn, `${s.wcf}file`)) {
        for (const r of await q(conn, `SELECT u.userID, f.fileID, f.fileHash, f.fileExtension FROM ${s.wcf}user u
            JOIN ${s.wcf}file f ON f.fileID = u.avatarFileID`)) {
          files.set(String(r.userID), path.join("_data", "public", "files", r.fileHash.slice(0, 2), r.fileHash.slice(2, 4), `${r.fileID}-${r.fileHash}.${r.fileExtension}`));
        }
      }
      if (await hasTable(conn, `${s.wcf}user_avatar`)) {
        for (const r of await q(conn, `SELECT avatarID, userID, fileHash, avatarExtension FROM ${s.wcf}user_avatar WHERE userID IS NOT NULL`)) {
          if (!files.has(String(r.userID))) {
            files.set(String(r.userID), path.join("images", "avatars", r.fileHash.slice(0, 2), `${r.avatarID}-${r.fileHash}.${r.avatarExtension}`));
          }
        }
      }
      if (files.size && !s.filesDir) {
        reporter.warn(`${files.size} avatar(s) are files: pass --files <WoltLab Suite folder> to bring them over.`);
      } else {
        for (const u of users) {
          const rel = files.get(u.sourceId);
          if (rel && fs.existsSync(path.join(s.filesDir!, rel))) u.avatar = { path: path.join(s.filesDir!, rel) };
        }
      }
    }

    // Bans live on the account: banned, banReason, banExpires (0 = permanent).
    const bans: ImportedBan[] = [];
    const ucols = await columns(conn, `${s.wcf}user`);
    if (ucols.has("banned")) {
      for (const r of await q(conn,
        `SELECT userID, ${pick(ucols, "banReason", "''")}, ${pick(ucols, "banExpires", "0")} FROM ${s.wcf}user WHERE banned = 1`)) {
        bans.push({ userSourceId: String(r.userID), reason: r.banReason ?? "", expiresAt: Number(r.banExpires) ? new Date(Number(r.banExpires) * 1000) : null });
      }
    }

    // ── articles (WoltLab Suite core) ────────────────────────────────────────
    const categories: ImportedCategory[] = [];
    const articles: ImportedArticle[] = [];
    if (await hasTable(conn, `${s.wcf}article`)) {
      for (const c of await q(conn,
        `SELECT c.categoryID, c.parentCategoryID, c.title, c.description FROM ${s.wcf}category c
           JOIN ${s.wcf}object_type ot ON ot.objectTypeID = c.objectTypeID
          WHERE ot.objectType = 'com.woltlab.wcf.article.category' ORDER BY c.parentCategoryID, c.showOrder`)) {
        categories.push({
          sourceId: String(c.categoryID),
          name: t(c.title),
          description: c.description ? t(c.description) : undefined,
          parentSourceId: c.parentCategoryID ? String(c.parentCategoryID) : undefined,
        });
      }
      // One language per article: the untranslated version, else the default language's.
      for (const a of await q(conn,
        `SELECT a.articleID, a.userID, a.time, a.categoryID, a.publicationStatus, a.publicationDate, a.isDeleted,
                ac.title, ac.teaser, ac.content
           FROM ${s.wcf}article a
           JOIN ${s.wcf}article_content ac ON ac.articleContentID = (
             SELECT ac2.articleContentID FROM ${s.wcf}article_content ac2
               LEFT JOIN ${s.wcf}language l ON l.languageID = ac2.languageID
              WHERE ac2.articleID = a.articleID
              ORDER BY (ac2.languageID IS NULL) DESC, l.isDefault DESC LIMIT 1)`)) {
        if (a.isDeleted) { skipped.push({ entity: "article", sourceId: String(a.articleID), reason: "deleted" }); continue; }
        if (!a.userID) { skipped.push({ entity: "article", sourceId: String(a.articleID), reason: "no author account" }); continue; }
        articles.push({
          sourceId: String(a.articleID),
          authorSourceId: String(a.userID),
          categorySourceId: String(a.categoryID),
          title: a.title,
          contentHtml: woltlabMessageToHtml(a.content ?? ""),
          excerpt: a.teaser || undefined,
          status: a.publicationStatus === 1 ? "published" : "draft",
          publishedAt: a.publicationStatus === 1 ? new Date((a.publicationDate || a.time) * 1000) : undefined,
          createdAt: new Date(a.time * 1000),
        });
      }
    }

    // Comments: one table for every kind (articles, profiles, …), told apart by object type.
    // An object type is named per definition: a thread's tag type and its watch type share
    // the name "com.woltlab.wbb.thread" and differ only by definition, so match both.
    const objectType = async (name: string, definition: string) => (await optional<{ objectTypeID: number }>(conn,
      `SELECT ot.objectTypeID FROM ${s.wcf}object_type ot
         JOIN ${s.wcf}object_type_definition d ON d.definitionID = ot.definitionID
        WHERE ot.objectType = ? AND d.definitionName = ?`, [name, definition], () => undefined))[0]?.objectTypeID;
    const commentsOf = async (typeName: string) => {
      const type = await objectType(typeName, "com.woltlab.wcf.comment.commentableContent");
      if (!type || !(await hasTable(conn, `${s.wcf}comment`))) return { top: [] as Row[], replies: [] as Row[] };
      const top = await q(conn, `SELECT commentID, objectID, userID, time, message FROM ${s.wcf}comment
                                  WHERE objectTypeID = ? AND isDisabled = 0 AND userID IS NOT NULL ORDER BY time`, [type]);
      const replies = await optional(conn, `SELECT r.responseID, r.commentID, r.userID, r.time, r.message FROM ${s.wcf}comment_response r
                                  JOIN ${s.wcf}comment c ON c.commentID = r.commentID
                                 WHERE c.objectTypeID = ? AND r.isDisabled = 0 AND r.userID IS NOT NULL ORDER BY r.time`, [type], () => undefined);
      return { top, replies };
    };

    // Article comments, only on articles that come over. Xentium comments are plain text.
    const comments: ImportedComment[] = [];
    const articleIds = new Set(articles.map((a) => a.sourceId));
    {
      const { top, replies } = await commentsOf("com.woltlab.wcf.articleComment");
      for (const c of top) {
        if (!articleIds.has(String(c.objectID))) continue;
        comments.push({ sourceId: `c${c.commentID}`, articleSourceId: String(c.objectID), authorSourceId: String(c.userID),
          bodyText: htmlToText(woltlabMessageToHtml(c.message ?? "")), createdAt: new Date(c.time * 1000) });
      }
      const articleOf = new Map(comments.map((c) => [c.sourceId, c.articleSourceId]));
      for (const r of replies) {
        const article = articleOf.get(`c${r.commentID}`);
        if (!article) continue;
        comments.push({ sourceId: `r${r.responseID}`, articleSourceId: article, authorSourceId: String(r.userID),
          parentSourceId: `c${r.commentID}`, bodyText: htmlToText(woltlabMessageToHtml(r.message ?? "")), createdAt: new Date(r.time * 1000) });
      }
    }

    // Profile walls: comments on a member's profile, with their replies.
    const profileComments: ImportedProfileComment[] = [];
    {
      const { top, replies } = await commentsOf("com.woltlab.wcf.user.profileComment");
      for (const c of top) {
        profileComments.push({ sourceId: `c${c.commentID}`, profileUserSourceId: String(c.objectID), authorSourceId: String(c.userID),
          bodyHtml: woltlabMessageToHtml(c.message ?? ""), createdAt: new Date(c.time * 1000) });
      }
      const ownerOf = new Map(profileComments.map((c) => [c.sourceId, c.profileUserSourceId]));
      for (const r of replies) {
        const owner = ownerOf.get(`c${r.commentID}`);
        if (!owner) continue;
        profileComments.push({ sourceId: `r${r.responseID}`, profileUserSourceId: owner, authorSourceId: String(r.userID),
          parentSourceId: `c${r.commentID}`, bodyHtml: woltlabMessageToHtml(r.message ?? ""), createdAt: new Date(r.time * 1000) });
      }
    }

    // ── forum (Burning Board) ────────────────────────────────────────────────
    const forumNodes: ImportedForumNode[] = [];
    const threads: ImportedThread[] = [];
    const prefixes: ImportedPrefix[] = [];
    let posts: Rows<ImportedPost> = [];
    const postLikes: ImportedPostLike[] = [];
    const open = () => connect(s.db);
    const close = (c: Conn) => c.end();
    const subscriptions: ImportedSubscription[] = [];
    if (await hasTable(conn, `${s.wbb}board`)) {
      for (const b of await q(conn, `SELECT boardID, parentID, boardType, title, description, position FROM ${s.wbb}board ORDER BY parentID, position`)) {
        const kind = boardKind(Number(b.boardType));
        if (!kind) { skipped.push({ entity: "forum_node", sourceId: String(b.boardID), reason: "link board (no content)" }); continue; }
        forumNodes.push({
          sourceId: String(b.boardID),
          parentSourceId: b.parentID ? String(b.parentID) : undefined,
          type: kind,
          name: t(b.title),
          description: b.description ? t(b.description) : undefined,
          position: b.position,
        });
      }

      const tc = await columns(conn, `${s.wbb}thread`);
      const kept = new Set<number>();
      for (const r of await q(conn,
        `SELECT threadID, boardID, topic, userID, time, ${pick(tc, "isClosed", "0")}, ${pick(tc, "isSticky", "0")},
                ${pick(tc, "isAnnouncement", "0")}, ${pick(tc, "isDisabled", "0")}, ${pick(tc, "isDeleted", "0")},
                ${pick(tc, "movedThreadID", "NULL")}, ${pick(tc, "views", "0")}
           FROM ${s.wbb}thread`)) {
        const why = threadSkipReason(r as WbbThreadFlags);
        if (why) { skipped.push({ entity: "thread", sourceId: String(r.threadID), reason: why }); continue; }
        threads.push({
          sourceId: String(r.threadID),
          nodeSourceId: String(r.boardID),
          authorSourceId: String(r.userID),
          title: r.topic,
          status: r.isClosed ? "locked" : "open",
          isPinned: !!(r.isSticky || r.isAnnouncement),
          viewCount: Number(r.views) || 0,
          createdAt: new Date(r.time * 1000),
        });
        kept.add(r.threadID);
      }

      // Labels → thread prefixes. A label belongs to a label group; a group is offered in
      // boards (label_group_to_object). A thread may carry one label per group, and a
      // Xentium thread has one prefix, so the first group's label wins.
      const threadLabelType = await objectType("com.woltlab.wbb.thread", "com.woltlab.wcf.label.object");
      const boardLabelType = await objectType("com.woltlab.wbb.board", "com.woltlab.wcf.label.objectType");
      const labelRows = await optional<{ labelID: number; groupID: number; label: string; cssClassName: string | null; groupOrder: number }>(conn,
        `SELECT l.labelID, l.groupID, l.label, l.cssClassName, COALESCE(g.showOrder, 0) AS groupOrder
           FROM ${s.wcf}label l LEFT JOIN ${s.wcf}label_group g ON g.groupID = l.groupID
          ORDER BY COALESCE(g.showOrder, 0), l.groupID, ${(await columns(conn, `${s.wcf}label`)).has("showOrder") ? "l.showOrder" : "0"}, l.labelID`,
        [], () => undefined);
      if (labelRows.length) {
        const groupBoards = new Map<number, string[]>();
        if (boardLabelType) {
          for (const r of await q<{ groupID: number; objectID: number }>(conn,
            `SELECT groupID, objectID FROM ${s.wcf}label_group_to_object WHERE objectTypeID = ?`, [boardLabelType])) {
            groupBoards.set(r.groupID, [...(groupBoards.get(r.groupID) ?? []), String(r.objectID)]);
          }
        }
        for (const l of labelRows) {
          prefixes.push({ sourceId: String(l.labelID), label: t(l.label), tone: toneOfClass(l.cssClassName), nodeSourceIds: groupBoards.get(l.groupID) });
        }
        if (threadLabelType) {
          const rank = new Map(labelRows.map((l, i) => [l.labelID, i]));
          const best = new Map<string, number>();
          for (const r of await q<{ labelID: number; objectID: number }>(conn,
            `SELECT labelID, objectID FROM ${s.wcf}label_object WHERE objectTypeID = ?`, [threadLabelType])) {
            const cur = best.get(String(r.objectID));
            if (rank.has(r.labelID) && (cur === undefined || rank.get(r.labelID)! < rank.get(cur)!)) best.set(String(r.objectID), r.labelID);
          }
          for (const th of threads) { const l = best.get(th.sourceId); if (l !== undefined) th.prefixSourceId = String(l); }
        }
      }

      // Posts in pages: a big board's bodies don't fit in memory (batches.ts).
      const pc = await columns(conn, `${s.wbb}post`);
      const postFlags = `${pick(pc, "isDisabled", "0")}, ${pick(pc, "isDeleted", "0")}`;
      posts = keyset({
        total: Number((await q(conn, `SELECT COUNT(*) n FROM ${s.wbb}post`))[0]?.n ?? 0),
        connect: open, close,
        fetch: (c, after, limit) => q(c,
          `SELECT postID, threadID, userID, message, time, ${pick(pc, "lastEditTime", "0")}, ${postFlags}
             FROM ${s.wbb}post WHERE postID > ? ORDER BY postID LIMIT ?`, [after, limit]),
        key: (r) => Number(r.postID),
        map: (page) => page.flatMap((r) => {
          if (!kept.has(r.threadID)) { skipped.push({ entity: "post", sourceId: String(r.postID), reason: "its thread was not imported" }); return []; }
          const why = postSkipReason(r as WbbThreadFlags);
          if (why) { skipped.push({ entity: "post", sourceId: String(r.postID), reason: why }); return []; }
          return [{
            sourceId: String(r.postID),
            threadSourceId: String(r.threadID),
            authorSourceId: String(r.userID),
            bodyHtml: woltlabMessageToHtml(r.message ?? ""),
            createdAt: new Date(r.time * 1000),
            editedAt: r.lastEditTime ? new Date(r.lastEditTime * 1000) : undefined,
          }];
        }),
      });

      // Reactions on posts become likes (every reaction type is a like in Xentium),
      // on the posts that come over: in a thread we kept, and not skipped themselves.
      for (const l of await optional(conn,
        `SELECT l.objectID, l.userID, l.time, p.threadID, p.userID AS author,
                ${pc.has("isDisabled") ? "p.isDisabled" : "0 AS isDisabled"}, ${pc.has("isDeleted") ? "p.isDeleted" : "0 AS isDeleted"}
           FROM ${s.wcf}like l
           JOIN ${s.wcf}object_type ot ON ot.objectTypeID = l.objectTypeID
           JOIN ${s.wbb}post p ON p.postID = l.objectID
          WHERE ot.objectType = 'com.woltlab.wbb.likeablePost'`, [],
        () => reporter.warn("No like table found: reactions are not carried over."))) {
        if (kept.has(l.threadID) && !postSkipReason({ userID: l.author, isDisabled: l.isDisabled, isDeleted: l.isDeleted })) {
          postLikes.push({ postSourceId: String(l.objectID), userSourceId: String(l.userID), createdAt: new Date(l.time * 1000) });
        }
      }
      // Tags and thread watches, by object type; only for threads that came over.
      const threadIds = new Set(threads.map((t) => t.sourceId));
      const threadType = await objectType("com.woltlab.wbb.thread", "com.woltlab.wcf.tagging.taggableObject");
      if (threadType) {
        const tagRows = await optional(conn, `SELECT tto.objectID, t.name FROM ${s.wcf}tag_to_object tto
            JOIN ${s.wcf}tag t ON t.tagID = tto.tagID WHERE tto.objectTypeID = ?`, [threadType], () => undefined);
        const byThread = new Map<string, string[]>();
        for (const r of tagRows) byThread.set(String(r.objectID), [...(byThread.get(String(r.objectID)) ?? []), r.name]);
        for (const t of threads) t.tags = byThread.get(t.sourceId);
      }
      const watchType = await objectType("com.woltlab.wbb.thread", "com.woltlab.wcf.user.objectWatch");
      if (watchType) {
        for (const r of await optional(conn, `SELECT userID, objectID FROM ${s.wcf}user_object_watch WHERE objectTypeID = ?`,
          [watchType], () => reporter.warn("No watch table found: thread subscriptions are not carried over."))) {
          if (threadIds.has(String(r.objectID))) subscriptions.push({ userSourceId: String(r.userID), threadSourceId: String(r.objectID) });
        }
      }
    } else {
      reporter.warn("No Burning Board tables found: importing members and articles only.");
    }

    const follows: ImportedFollow[] = (await optional(conn, `SELECT userID, followUserID, time FROM ${s.wcf}user_follow`, [],
      () => reporter.warn("No follow table found: follows are not carried over.")))
      .map((r) => ({ followerSourceId: String(r.userID), followingSourceId: String(r.followUserID), createdAt: new Date(r.time * 1000) }));
    const blocks: ImportedBlock[] = (await optional(conn, `SELECT userID, ignoreUserID FROM ${s.wcf}user_ignore`, [],
      () => reporter.warn("No ignore table found: ignore lists are not carried over.")))
      .map((r) => ({ blockerSourceId: String(r.userID), blockedSourceId: String(r.ignoreUserID) }));

    // ── conversations. hideConversation: 0 shown, 1 hidden by that member; leftAt > 0 = left.
    //    Drafts were never sent, so they stay out.
    const conversations: ImportedConversation[] = [];
    let messages: Rows<ImportedMessage> = [];
    if (await hasTable(conn, `${s.wcf}conversation`)) {
      const cc = await columns(conn, `${s.wcf}conversation`);
      const people = new Map<number, ImportedConversation["participants"]>();
      const uc = await columns(conn, `${s.wcf}conversation_to_user`);
      for (const r of await q(conn,
        `SELECT conversationID, participantID, ${pick(uc, "hideConversation", "0")}, ${pick(uc, "leftAt", "0")}
           FROM ${s.wcf}conversation_to_user WHERE participantID IS NOT NULL`)) {
        people.set(r.conversationID, [...(people.get(r.conversationID) ?? []),
          { userSourceId: String(r.participantID), archived: Number(r.hideConversation) === 1, left: Number(r.leftAt) > 0 }]);
      }
      for (const c of await q(conn,
        `SELECT conversationID, subject, time, userID, ${pick(cc, "isDraft", "0")} FROM ${s.wcf}conversation`)) {
        if (c.isDraft) { skipped.push({ entity: "conversation", sourceId: String(c.conversationID), reason: "an unsent draft" }); continue; }
        if (!c.userID) { skipped.push({ entity: "conversation", sourceId: String(c.conversationID), reason: "its starter's account is gone" }); continue; }
        conversations.push({
          sourceId: String(c.conversationID),
          starterSourceId: String(c.userID),
          title: c.subject,
          participants: people.get(c.conversationID) ?? [],
          createdAt: new Date(c.time * 1000),
        });
      }
      const kept = new Set(conversations.map((c) => c.sourceId));
      messages = keyset({
        total: Number((await q(conn, `SELECT COUNT(*) n FROM ${s.wcf}conversation_message`))[0]?.n ?? 0),
        connect: open, close,
        fetch: (c, after, limit) => q(c,
          `SELECT messageID, conversationID, userID, message, time FROM ${s.wcf}conversation_message
            WHERE messageID > ? ORDER BY messageID LIMIT ?`, [after, limit]),
        key: (m) => Number(m.messageID),
        map: (page) => page.flatMap((m) => {
          if (!kept.has(String(m.conversationID))) return [];
          if (!m.userID) { skipped.push({ entity: "message", sourceId: String(m.messageID), reason: "its sender's account is gone" }); return []; }
          return [{
            sourceId: String(m.messageID),
            conversationSourceId: String(m.conversationID),
            senderSourceId: String(m.userID),
            bodyHtml: woltlabMessageToHtml(m.message ?? ""),
            createdAt: new Date(m.time * 1000),
          }];
        }),
      });
    }

    return {
      sourceInfo: `WoltLab Suite ${v.wcf}`,
      conversations,
      messages,
      users, groups, categories, articles, comments, subscriptions, bans, profileComments,
      forumNodes, prefixes, threads, posts, postLikes, follows, blocks, skipped,
    };
  } finally {
    await conn.end();
  }
}

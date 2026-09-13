import { readFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";
import type { ExtractResult, ImportedComment, ImportError } from "@nodevo/migrate-core";

/**
 * WXR (WordPress eXtended RSS) extractor. Consumes the export *file* — no
 * WordPress installation, database, or credentials are ever needed (§34).
 *
 * Known WXR limitations, surfaced as inspect() warnings:
 *  - no password hashes → users are imported with an unusable password and
 *    reset it once (DB-based import is a possible future --source-db mode)
 *  - no user roles → everyone lands in Member
 *  - media is referenced by URL, not bundled → attachments are skipped in v1
 */

interface WxrItem {
  title?: unknown;
  "dc:creator"?: unknown;
  "content:encoded"?: unknown;
  "excerpt:encoded"?: unknown;
  "wp:post_id"?: unknown;
  "wp:post_date_gmt"?: unknown;
  "wp:status"?: unknown;
  "wp:post_type"?: unknown;
  category?: unknown;
  "wp:comment"?: unknown;
}

const ALWAYS_ARRAYS = new Set([
  "rss.channel.item",
  "rss.channel.wp:author",
  "rss.channel.wp:category",
  "rss.channel.item.category",
  "rss.channel.item.wp:comment",
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,       // keep ids/dates as strings
  parseAttributeValue: false,
  isArray: (_name, jpath) => ALWAYS_ARRAYS.has(String(jpath)),
});

/** Element text whether the node is a plain string or has attributes. */
function txt(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const obj = value as Record<string, unknown>;
  return txt(obj["#text"]);
}

function gmtDate(value: unknown): Date | undefined {
  const raw = txt(value);
  if (!raw || raw.startsWith("0000")) return undefined;
  const date = new Date(raw.replace(" ", "T") + "Z");
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export interface WxrParsed extends ExtractResult {
  wxrVersion: string;
  /** post_type → count of items not imported (page, attachment, …). */
  otherTypes: Record<string, number>;
  guestComments: number;
  unapprovedComments: number;
}

export function parseWxr(filePath: string): WxrParsed {
  const xml = readFileSync(filePath, "utf8");
  const doc = parser.parse(xml);
  const channel = doc?.rss?.channel;
  if (!channel) throw new Error("Not a WXR file (missing rss > channel)");

  const skipped: ImportError[] = [];
  const wxrVersion = txt(channel["wp:wxr_version"]) || "?";

  // ── users (wp:author entries) ────────────────────────────────────────────
  const loginToId = new Map<string, string>();
  const users = ((channel["wp:author"] ?? []) as Record<string, unknown>[])
    .map((a) => {
      const sourceId = txt(a["wp:author_id"]) || txt(a["wp:author_login"]);
      const login = txt(a["wp:author_login"]);
      loginToId.set(login, sourceId);
      return {
        sourceId,
        email: txt(a["wp:author_email"]),
        username: login,
        displayName: txt(a["wp:author_display_name"]) || undefined,
      };
    })
    .filter((u) => {
      if (!u.email || !u.username) {
        skipped.push({ entity: "user", sourceId: u.sourceId, reason: "missing email or login in WXR" });
        return false;
      }
      return true;
    });

  // ── categories (channel-level wp:category tree) ──────────────────────────
  const categories = ((channel["wp:category"] ?? []) as Record<string, unknown>[])
    .map((c) => ({
      sourceId: txt(c["wp:category_nicename"]),
      name: txt(c["wp:cat_name"]) || txt(c["wp:category_nicename"]),
      parentSourceId: txt(c["wp:category_parent"]) || undefined,
    }))
    .filter((c) => c.sourceId);

  // ── items → articles + comments; other post types are counted ────────────
  const articles: WxrParsed["articles"] = [];
  const comments: ImportedComment[] = [];
  const otherTypes: Record<string, number> = {};
  let guestComments = 0;
  let unapprovedComments = 0;

  for (const item of ((channel.item ?? []) as WxrItem[])) {
    const postType = txt(item["wp:post_type"]) || "post";
    const postId = txt(item["wp:post_id"]);

    if (postType !== "post") {
      otherTypes[postType] = (otherTypes[postType] ?? 0) + 1;
      continue;
    }

    const status = txt(item["wp:status"]);
    if (status === "trash" || status === "auto-draft") {
      skipped.push({ entity: "article", sourceId: postId, reason: `status "${status}"` });
      continue;
    }

    const authorSourceId = loginToId.get(txt(item["dc:creator"]));
    if (!authorSourceId) {
      skipped.push({ entity: "article", sourceId: postId, reason: `unknown author "${txt(item["dc:creator"])}"` });
      continue;
    }

    const itemCategories = (item.category ?? []) as Array<Record<string, unknown>>;
    const categorySourceId = itemCategories.find((c) => c["@_domain"] === "category")?.["@_nicename"] as string | undefined;
    const tags = itemCategories
      .filter((c) => c["@_domain"] === "post_tag")
      .map((c) => txt(c))
      .filter(Boolean);

    articles.push({
      sourceId: postId,
      authorSourceId,
      categorySourceId,
      title: txt(item.title) || "(untitled)",
      contentHtml: txt(item["content:encoded"]),
      excerpt: txt(item["excerpt:encoded"]) || undefined,
      status: status === "publish" ? "published" : "draft",
      publishedAt: gmtDate(item["wp:post_date_gmt"]),
      createdAt: gmtDate(item["wp:post_date_gmt"]),
      tags,
    });

    for (const c of ((item["wp:comment"] ?? []) as Record<string, unknown>[])) {
      const commentId = txt(c["wp:comment_id"]);
      if (txt(c["wp:comment_approved"]) !== "1") {
        unapprovedComments++;
        continue;
      }
      const userId = txt(c["wp:comment_user_id"]);
      if (!userId || userId === "0") {
        // Xentium comments require an account (§33) — guests can't be imported.
        guestComments++;
        skipped.push({ entity: "comment", sourceId: commentId, reason: `guest comment by "${txt(c["wp:comment_author"])}"` });
        continue;
      }
      const parent = txt(c["wp:comment_parent"]);
      comments.push({
        sourceId: commentId,
        articleSourceId: postId,
        authorSourceId: userId,
        bodyText: txt(c["wp:comment_content"]).trim(),
        parentSourceId: parent && parent !== "0" ? parent : undefined,
        createdAt: gmtDate(c["wp:comment_date_gmt"]),
      });
    }
  }

  return {
    sourceInfo: `WordPress (WXR ${wxrVersion})`,
    users, categories, articles, comments, skipped,
    wxrVersion, otherTypes, guestComments, unapprovedComments,
  };
}

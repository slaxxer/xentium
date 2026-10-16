import type { RedirectSpec } from "@xentium/migrate-core";

/**
 * WoltLab's addresses in every URL mode: `index.php?thread/12-title/`, the older
 * `index.php/Thread/12-title/`, rewritten `thread/12-title/`, and WBB 3's
 * `index.php?page=Thread&threadID=12`. The rewritten form looks like ours
 * ("/forum/thread/2024-plans"), so it needs WoltLab's trailing slash after the title,
 * and nothing after that but a query (our edit page is /forum/thread/<slug>/edit/…).
 */
const B = String.raw`^/(?:[^?]*/)?(?:index\.php[?/]/?)?`;
const ID = String.raw`(?<id>\d+)(?:-[^/?]*)?/(?:[?&]|$)`;
const query = (name: string) => String.raw`^/[^#]*[?&;]${name}=(?<id>\d+)`;

export const woltlabRedirects: RedirectSpec = {
  patterns: [
    { entity: "post", regex: query("postID") },
    { entity: "thread", regex: `${B}thread/${ID}` },
    { entity: "thread", regex: query("threadID") },
    { entity: "forum_node", regex: `${B}board/${ID}` },
    { entity: "forum_node", regex: query("boardID") },
    { entity: "article", regex: `${B}article/${ID}` },
    { entity: "article", regex: query("articleID") },
    { entity: "user", regex: `${B}user/${ID}` },
    { entity: "user", regex: query("userID") },
  ],
};

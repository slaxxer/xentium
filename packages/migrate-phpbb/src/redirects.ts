import type { RedirectSpec } from "@xentium/migrate-core";

/** Any folder the board lived in, then the script. `[&;]` also takes `&amp;` from pasted links. */
const B = String.raw`^/(?:[^?]*/)?`;
const arg = (name: string) => String.raw`\?(?:[^#]*[&;])?${name}=(?<id>\d+)`;

/** phpBB's addresses: viewtopic.php?t= / ?p=, viewforum.php?f=, memberlist.php?mode=viewprofile&u=. */
export const phpbbRedirects: RedirectSpec = {
  patterns: [
    { entity: "post", regex: `${B}viewtopic\\.php${arg("p")}` },
    { entity: "thread", regex: `${B}viewtopic\\.php${arg("t")}` },
    { entity: "forum_node", regex: `${B}viewforum\\.php${arg("f")}` },
    { entity: "user", regex: `${B}memberlist\\.php${arg("u")}` },
  ],
};

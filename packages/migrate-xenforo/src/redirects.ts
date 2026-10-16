import type { RedirectSpec } from "@xentium/migrate-core";

/** Any folder, with or without friendly URLs (`/index.php?threads/…`). */
const B = String.raw`^/(?:[^?]*/)?(?:index\.php\?)?`;
/** "title.123" or just "123", then the end of that segment. */
const ID = String.raw`(?:[^/?]*\.)?(?<id>\d+)(?:[/?&]|$)`;

/** XenForo 2's addresses: threads/title.1/, posts/5/, forums/name.2/, members/name.3/. */
export const xenforoRedirects: RedirectSpec = {
  patterns: [
    { entity: "post", regex: `${B}posts/(?<id>\\d+)` },
    { entity: "post", regex: `${B}threads/[^?#]*/post-(?<id>\\d+)` },
    { entity: "post", regex: `${B}goto/post[?&]id=(?<id>\\d+)` },
    { entity: "thread", regex: `${B}threads/${ID}` },
    { entity: "forum_node", regex: `${B}(?:forums|categories)/${ID}` },
    { entity: "user", regex: `${B}members/${ID}` },
  ],
};

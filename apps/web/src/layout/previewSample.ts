/**
 * Stand-in data for the layout editor's preview, and ONLY for it.
 *
 * A data block draws nothing when it has nothing — a member with no followers, no
 * rank, no badges. That is right on the site and useless in the editor, where an
 * admin arranging a rail sees "nothing to draw here" four times and cannot judge the
 * arrangement at all. The preview loads the ADMIN'S OWN profile (`/u/<me>`), so on a
 * new site the person laying the page out is exactly the person with no data.
 *
 * ⚠⚠ THE SAFETY RULE. Preview mode is a URL QUERY PARAM (`?__layout=draft`) — anyone
 * can type it. Gating sample data on that alone would let a visitor append it to a
 * real profile and be shown FABRICATED followers and a FABRICATED rank as if they
 * were that member's. So the gate is BOTH:
 *
 *   1. the editor's preview flag, and
 *   2. the viewer actually being staff.
 *
 * A guest or an ordinary member who types the parameter gets the honest empty state.
 * Draft LAYOUTS are already permission-gated server-side; this is the matching gate
 * for invented CONTENT, which the server cannot refuse because it never sends it.
 */
import { authStore } from "../lib/authStore";
import { isLayoutPreview } from "./useLayout";

/** Staff — the same test the ACP entry point uses. */
function viewerIsStaff(): boolean {
  const groups = authStore.user?.groups ?? [];
  return groups.some((g) => g.key === "admin" || g.key === "supermod" || g.key === "moderator");
}

/**
 * True only inside the layout editor's own preview, for a viewer allowed to be there.
 *
 * ⚠ `isLayoutPreview()` is the EDITOR flag (`__layout=draft`), not the theme
 * previewer's read-only `preview` mode — invented content has no business in "show me
 * my site with this theme", which an admin uses to decide whether the theme is right.
 */
export function showsSampleData(): boolean {
  return isLayoutPreview() && viewerIsStaff();
}

/**
 * `sample` when a block has nothing real to draw and we are in the editor, otherwise
 * `undefined` so the block self-gates exactly as it does on the site.
 *
 * Call it only on the empty branch — the real data must always win.
 */
export function previewSample<T>(sample: T): T | undefined {
  return showsSampleData() ? sample : undefined;
}


// ── The stand-ins ───────────────────────────────────────────────────────────
// Deliberately plain and obviously generic — a sample is a shape to arrange, not a
// mock-up to admire, and an admin must never mistake it for real member data.

export const SAMPLE_RANK = {
  enabled: true,
  showProgressBar: true,
  current: { badgeLabel: "Member",    badgeColor: "#00b1cf", ladderPosition: 1 },
  next:    { badgeLabel: "Regular",   badgeColor: "#23a55a", ladderPosition: 2 },
  atTop: false,
  percent: 60,
  primary: { label: "articles", have: 12, need: 20, remaining: 8 },
  unlocks: [
    { key: "articleLength", value: 40000 },
    { key: "dailyArticles", value: 6 },
  ],
};

export const SAMPLE_FOLLOWERS = {
  items: ["AB", "CD", "EF", "GH", "IJ"].map((n, i) => ({
    id: `sample-${i}`, username: n, avatar: null,
  })),
  total: 128,
};

export const SAMPLE_VISITORS = {
  items: ["KL", "MN", "OP", "QR", "ST"].map((n, i) => ({
    id: `sample-v-${i}`, username: n, avatar: null,
    viewedAt: new Date(Date.now() - (i + 1) * 9 * 60_000).toISOString(),
  })),
  visitors: 18,
  thisWeek: 18,
  totalViews: 1204,
  lastAt: new Date(Date.now() - 9 * 60_000).toISOString(),
};

/** Four earned, four still locked — enough to show the grid and the "+N". */
export const SAMPLE_BADGES = Array.from({ length: 8 }, (_, i) => ({
  id: `sample-b-${i}`,
  key: `sample-${i}`,
  name: ["First post", "100 likes", "Bug hunter", "Founder",
         "Plugin author", "Year one", "Top of week", "Helper"][i]!,
  description: null,
  icon: null,
  faIcon: ["faPen", "faHeart", "faBug", "faFlag", "faCode", "faClock", "faFire", "faLifeRing"][i]!,
  color: ["#5865f2", "#00b1cf", "#23a55a", "#f4a259", null, null, null, null][i] ?? null,
  displayOrder: 100,
  // ⚠ Same shape as an AWARDED badge, because the sampled ones stand in for both the
  // catalogue and the awards — a missing field here is a type error at the call site.
  note: null as string | null,
  awardedAt: "",
}));

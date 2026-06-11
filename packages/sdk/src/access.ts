// Single visibility chokepoint for any node whose visibility follows §39
// (article_categories, forum_nodes, nav_items, etc.). Returns whether the
// viewer is allowed to see the node — the caller decides what to do when the
// answer is false (404 vs locked-notice based on hide_if_no_access).
//
// Bulk listing queries should filter at the SQL level (§54) using the same
// rule shape. This function is for single-node request-level checks.
//
// Exposed via @nodevo/sdk so plugins (e.g. the forum node tree) reuse the
// exact same access logic instead of reimplementing it.

export const VISIBILITY_MODES = ["public", "members", "level", "groups"] as const;
export type VisibilityMode = (typeof VISIBILITY_MODES)[number];

export interface VisibilityNode {
  visibility: VisibilityMode;
  /** Used when visibility === 'groups'. Group IDs that may see the node. */
  visibilityGroups?: readonly string[];
  /** Used when visibility === 'level'. Minimum progression ladder position. */
  visibilityMinLevel?: number | null;
}

export interface ViewerContext {
  /** Undefined for guests. */
  userId?: string;
  /** Group IDs the viewer belongs to. Empty for guests. */
  groupIds: readonly string[];
  /** Effective progression ladder position. Undefined until Phase 7 wires it. */
  ladderPosition?: number;
  /** Effective permission set. Reserved for permission-gated visibility. */
  permissions?: ReadonlySet<string>;
}

export function userCanSeeNode(viewer: ViewerContext, node: VisibilityNode): boolean {
  switch (node.visibility) {
    case "public":
      return true;

    case "members":
      return Boolean(viewer.userId);

    case "level": {
      if (!viewer.userId) return false;
      const min = node.visibilityMinLevel;
      if (min == null) return true;
      const pos = viewer.ladderPosition ?? 0;
      return pos >= min;
    }

    case "groups": {
      if (!viewer.userId) return false;
      const allowed = node.visibilityGroups ?? [];
      if (allowed.length === 0) return false;
      return viewer.groupIds.some((g) => allowed.includes(g));
    }

    default: {
      const _exhaustive: never = node.visibility;
      void _exhaustive;
      return false;
    }
  }
}

/**
 * Resolves effective visibility down an ancestor chain. Most restrictive wins.
 * Pass the node first, then its parents in order (parent, grandparent, ...).
 *
 * The `effective_visibility` precomputed cache on nodes is the same idea
 * applied at write-time so list queries can filter without walking ancestors.
 */
export function resolveEffectiveVisibility(
  ...chain: readonly VisibilityNode[]
): VisibilityNode {
  return chain.reduce((acc, cur) => mostRestrictive(acc, cur));
}

function mostRestrictive(a: VisibilityNode, b: VisibilityNode): VisibilityNode {
  const rank: Record<VisibilityMode, number> = {
    public: 0,
    members: 1,
    level: 2,
    groups: 3,
  };
  if (rank[a.visibility] === rank[b.visibility]) {
    // Same mode — keep the stricter parameters
    if (a.visibility === "level") {
      const aMin = a.visibilityMinLevel ?? 0;
      const bMin = b.visibilityMinLevel ?? 0;
      return aMin >= bMin ? a : b;
    }
    if (a.visibility === "groups") {
      const aGroups = a.visibilityGroups ?? [];
      const bGroups = b.visibilityGroups ?? [];
      const intersection = aGroups.filter((g) => bGroups.includes(g));
      return {
        visibility: "groups",
        visibilityGroups: intersection,
      };
    }
    return a;
  }
  return rank[a.visibility] > rank[b.visibility] ? a : b;
}

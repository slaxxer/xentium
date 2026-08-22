/**
 * @nodevo/plugin-sdk
 *
 * The authoring contract for Nodevo CMS plugins. Import this in your plugin's
 * server entry point.
 *
 * ── What changed, and what did not ─────────────────────────────────────────
 *
 * The application-agnostic half of this contract now lives in
 * `@nodevo/plugin-kit` — manifest, definition, host bridge and the base context
 * — so that a plugin for a DIFFERENT Nodevo-framework application (the
 * marketplace, for one) has something to build against that does not assume a
 * CMS.
 *
 * This package re-exports all of it and adds the CMS surface on top, so its
 * public shape is UNCHANGED. Existing plugins need no edits: `PluginContext`
 * still carries `registerSearchSource`, `PluginHost` still carries
 * `progression`, and one import still gets you everything.
 *
 * Companion docs for the parts that live on the WEB side (this package is the
 * server contract only):
 *  - `docs/plugin-acp-autosave.md` — ACP admin surfaces. Config pages and
 *    per-group panels AUTOSAVE (no Save button) via the host's `useAutosave` +
 *    `AutosaveStatus`; entity modals, secrets and destructive actions keep an
 *    explicit action. Read before building any plugin admin UI.
 *  - `docs/plugin-i18n.md` — bundling translated UI strings.
 */
import type {
  PluginContext as BasePluginContext,
  PluginDefinition as BasePluginDefinition,
  PluginHost as BasePluginHost,
} from "@nodevo/plugin-kit";

// Everything application-agnostic, re-exported so one import still suffices.
export type {
  PluginRouter,
  PluginManifest,
  PermissionDeclaration,
  NecCodeDeclaration,
  NotifyOptions,
} from "@nodevo/plugin-kit";

// ── CMS declarations ─────────────────────────────────────────────────────────

export interface NavItemDeclaration {
  label:       string;
  url:         string;
  icon?:       string;
  position?:   number;
  visibility?: "public" | "members";
}

export interface AcpPageDeclaration {
  section: string;                 // ACP nav section label
  label:   string;
  path:    string;                 // frontend route path e.g. "/admin/forum/categories"
  icon?:   string;
}

/** A normalized search hit (source-agnostic). Mirrors HomeFeedItem — core never
 *  builds this from plugin tables; the source produces it. */
export interface SearchResultItem {
  id:             string;
  title:          string;
  link:           string;                  // e.g. "/forum/thread/{slug}"
  excerpt?:       string | null;
  categoryLabel?: string | null;
  author?:        { username: string; avatar: string | null } | null;
  metric?:        number;                   // primary count (e.g. replies)
  metricLabel?:   string;                   // e.g. "replies"
  tags?:          string[];
  createdAt:      string;                   // ISO timestamp
  rank?:          number;                   // relevance score, for merge ordering
}

/** A search content source a plugin contributes. Core asks the source to run the
 *  search — it never queries the plugin's tables or knows its schema. The source
 *  `id` doubles as the GET /api/search ?type= value and the web slotRegistry tab id. */
export interface SearchSource {
  id:          string;             // e.g. "forum"
  label:       string;             // tab label
  permission?: string | null;      // null = public
  search(
    query: string,
    opts: { isLoggedIn: boolean; page: number; limit: number },
  ): Promise<{ data: SearchResultItem[]; total: number }>;
}

/** A normalized item for the home / guest feed (source-agnostic). */
export interface HomeFeedItem {
  id:             string;
  title:          string;
  link:           string;                  // e.g. "/forum/thread/{slug}"
  excerpt?:       string | null;
  categoryLabel?: string | null;           // e.g. forum node / article category name
  author?:        { username: string; avatar: string | null } | null;
  metric?:        number;                   // primary count shown in the votes box (likes/replies)
  metricLabel?:   string;                   // e.g. "likes" | "replies"
  replies?:       number;
  views?:         number;
  createdAt:      string;                   // ISO timestamp — used to merge sources by recency
}

/** A content source a plugin contributes to the home / guest feed. Core never
 *  queries the plugin's tables directly — it asks the source for items. */
export interface HomeFeedSource {
  id:    string;                            // e.g. "forum"
  label: string;                            // shown in ACP → Appearance → Guest Home
  recent(limit: number): Promise<HomeFeedItem[]>;
  hot?(limit: number): Promise<HomeFeedItem[]>; // optional — powers the "Hot threads" home rail
}

/** A site-wide counter a plugin contributes to the footer (e.g. forum thread /
 *  post totals). `id` is a machine key the client localizes (falling back to
 *  `label`); `label` is the English fallback. */
export interface FooterStat {
  id:    string;
  label: string;
  value: number;
}

/** A stats source a plugin contributes. Core aggregates registered sources for
 *  the footer — it never queries the plugin's tables or knows its schema. */
export interface StatSource {
  id: string;                        // e.g. "forum"
  collect(): Promise<FooterStat[]>;
}

/** Progression promotion criteria a plugin contributes (§38). Core's promotion
 *  job asks each registered criteria whether a user meets a target ladder
 *  group's plugin-configured thresholds. `evaluate` returns ONE boolean per
 *  threshold this plugin has set for `groupId` (empty if none) — core ANDs/ORs
 *  them with its own checks per `progression.threshold_logic`. The plugin owns
 *  the per-group thresholds AND the user's metrics; core never sees its schema. */
export interface ProgressionCriteria {
  id: string;                        // e.g. "forum"
  evaluate(userId: string, groupId: string): Promise<boolean[]>;
  /** Optional, DISPLAY ONLY: the same thresholds as have/need pairs, so the
   *  member-facing progress bar shows what promotion actually gates on. Never
   *  consulted by the promotion job — `evaluate` stays the single source of
   *  truth. Derive both from one helper so they cannot drift. */
  metrics?(userId: string, groupId: string): Promise<ProgressionMetric[]>;
}

/** One numeric threshold's progress, as shown in the progression UI. */
export interface ProgressionMetric {
  key:   string;                     // unique within the plugin, e.g. "forum.posts"
  /** Doubles as a `progression.metric.<label>` translation key AND as the literal
   *  text the UI falls back to when no locale defines it — keep it readable
   *  (e.g. "forum posts", not "forumPosts"). */
  label: string;
  have:  number;
  need:  number;
}

// ── Layout templates (ADR-0005 Amendment 3) ──────────────────────────────────

/** One block in a template's default arrangement. Mirrors core's `BlockNode`. */
export interface LayoutBlockNode {
  /** Unique within the document — the editor and the preview both address by it. */
  id:        string;
  /** A registered block type: core's (`heading`) or your own (`forum.categories`). */
  type:      string;
  props?:    Record<string, unknown>;
  children?: LayoutBlockNode[];
}

/** A template's default arrangement: blocks per region. */
export interface LayoutTemplateDocument {
  templateKey: string;
  regions:     Record<string, LayoutBlockNode[]>;
}

/**
 * A page your plugin owns, opened up to the layout editor.
 *
 * Declare it ONCE — a shared module your server entry and your web entry both
 * import — and register it on both sides: `ctx.registerLayoutTemplate(decl)` here,
 * and the host's `@web/layout/templateRegistry` from your web entry. The server's
 * copy decides what may be SAVED; the browser's decides what RENDERS.
 *
 * Your page component then renders `<LayoutRenderer templateKey={...} context={…} />`
 * instead of its own markup, and resolves its own data first — a block renders, the
 * host fetches.
 */
export interface LayoutTemplateDeclaration {
  /**
   * Namespaced, e.g. `forum.index`. A bare word is refused, and so is any key core
   * already owns — a plugin must never be able to redefine `home`.
   */
  key:    string;
  /** Admin-facing name, shown in the layout editor's template picker. */
  label:  string;
  /**
   * Region names, in RENDER ORDER. Order comes from here and never from the stored
   * document, whose key order a `jsonb` column does not preserve.
   */
  regions: string[];
  /**
   * What the page renders before an admin arranges anything — normally the blocks
   * that reproduce your current markup, so adopting a template changes nothing
   * visible until somebody moves something.
   *
   * Held to exactly what a save is held to: unknown regions, a bad tree or a
   * missing required block refuses the registration, and the plugin does not enable.
   */
  defaultDocument: LayoutTemplateDocument;
  /** Block types the template refuses to be saved without. Use sparingly. */
  requiredBlocks?: string[];
  /** Same-origin path the ACP previews at, e.g. `/forum`. */
  previewRoute?: string;
  /**
   * Set it to your plugin id when you share this declaration with your web entry,
   * which has no context to infer it from. The server refuses a value that is not
   * yours.
   */
  pluginId?: string;
}

// ── Host bridge ──────────────────────────────────────────────────────────────

/**
 * The CMS's host bridge: everything `@nodevo/plugin-kit` guarantees (prisma,
 * queues, env, logger, errors, middleware, cron), plus what only a community
 * platform can offer.
 */
export interface PluginHost extends BasePluginHost {
  /**
   * Progression primitives (§38). Core owns the ladder; a plugin owns the
   * thresholds and limits for its own content, keyed by the group id this
   * returns.
   */
  progression: {
    /** The group whose progression config governs `userId` — their highest rung
     *  on the ladder — or null when the user is not on it. */
    getEffectiveGroupId: (userId: string) => Promise<string | null>;
  };

  /** Core notification service — dispatch passes through all fields incl. meta. */
  notificationService: {
    dispatch: (opts: any) => Promise<void>;
  };

  /** Core moderation primitives, for plugin security scans. */
  security: {
    /** Open a review case (dedup + notify case managers), identical to core
     *  security-analysis cases. `type` is a free string (e.g. "impossible_travel"). */
    createCase: (opts: { type: string; severity: "low" | "medium" | "high"; signals: string[]; userIds: string[] }) => Promise<void>;
    /** Permanently ban all non-staff, not-already-banned accounts in the set
     *  (system-attributed). Returns the banned usernames. Used by paid auto-ban. */
    autoBanMultiaccounts: (userIds: string[], reason: string) => Promise<string[]>;
  };

  utils: BasePluginHost["utils"] & {
    resolveAvatar: (...args: any[]) => any;
    /** Sanitize user-authored rich-text HTML (allowlist) before storage.
     *  Plugins accepting HTML bodies MUST run them through this on write. */
    sanitizeRichText: (html: string) => string;
  };
}

// ── Context ──────────────────────────────────────────────────────────────────

/**
 * What the CMS hands a plugin at enable time: the base context, plus every
 * registration that only makes sense on a content and community platform.
 */
export interface PluginContext extends BasePluginContext<PluginHost> {
  /** Register a frontend nav item. */
  registerNavItem(item: NavItemDeclaration): Promise<void>;

  /** Register ACP sidebar pages (returned by GET /api/admin/registered-pages). */
  registerAcpPage(page: AcpPageDeclaration): void;

  /** Register notification type strings for the user preference UI. */
  registerNotificationTypes(types: string[]): void;

  /** Register a search content source. Core asks it to run the search and
   *  merges results — it never queries the plugin's tables. */
  registerSearchSource(source: SearchSource): void;

  /** Register a home/guest feed content source. */
  registerHomeFeedSource(source: HomeFeedSource): void;

  /** Register a site-stats source shown in the footer. Deregistered on disable. */
  registerStatSource(source: StatSource): void;

  /** Register progression promotion criteria (§38). A disabled plugin's criteria
   *  stop counting. The admin UI for its thresholds belongs in the core Group
   *  settings dialog via the web-side `groupConfigPanel` slot, and autosaves —
   *  see `docs/plugin-acp-autosave.md`. */
  registerProgressionCriteria(criteria: ProgressionCriteria): void;

  /** Open one of this plugin's own pages to the layout editor (ADR-0005).
   *  Throws on a declaration core will not accept, failing the enable rather
   *  than half-registering. Deregistered on disable — stored layouts are KEPT,
   *  so re-enabling restores them. */
  registerLayoutTemplate(template: LayoutTemplateDeclaration): void;

  /** Register a periodic security scan, invoked by the core security-analysis
   *  job after its built-in patterns. Use `host.security.createCase` to open
   *  review cases. Deregistered on disable. */
  registerSecurityScan(fn: () => Promise<void>): void;

  /** Declare that this plugin REPLACES the named core baseline detection
   *  patterns (§15 case types): core skips its built-in version while the
   *  plugin is enabled. Claims are released on disable, restoring the baseline. */
  claimSecurityPatterns(patterns: string[]): void;
}

// ── Definition ───────────────────────────────────────────────────────────────

/** What a CMS plugin's server entry exports. */
export type PluginDefinition = BasePluginDefinition<PluginContext>;

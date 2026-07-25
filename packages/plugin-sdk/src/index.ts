/**
 * @nodevo/plugin-sdk
 *
 * Public contract for building Nodevo plugins.
 * Import this package in your plugin's server entry point.
 */

// Use a structural type so plugin-sdk doesn't need express as a direct dep.
// Express Router satisfies this interface.
export interface PluginRouter {
  use: (...args: any[]) => any;
  get:    (...args: any[]) => any;
  post:   (...args: any[]) => any;
  patch:  (...args: any[]) => any;
  put:    (...args: any[]) => any;
  delete: (...args: any[]) => any;
}

// ── Manifest ──────────────────────────────────────────────────────────────────

export interface PluginManifest {
  id:               string;        // kebab-case, unique e.g. "nodevo-forum"
  name:             string;
  version:          string;        // semver
  vendor:           string;
  minNodevoVersion: string;
  maxNodevoVersion?: string;
  licenseRequired:  boolean;
  tablePrefix?:     string;        // e.g. "forum_" — when set, every DB object this plugin's migrations create/alter/drop MUST carry it
  permissions:      string[];      // permission keys declared by this plugin
  migrations:       string[];      // migration names (without .up/.down.sql)
  entrypoints: {
    server?: string;               // relative path to server entry file
    web?:    string;               // relative path to web entry file
  };
}

// ── Registration types ────────────────────────────────────────────────────────

export interface PermissionDeclaration {
  key:      string;                // e.g. "forum.thread.create"
  label:    string;
  domain:   string;                // ACP section header e.g. "Forum"
  defaults?: string[];             // group keys that get this permission on first install
}

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

export interface NotifyOptions {
  userId:   string;
  type:     string;
  title:    string;
  body:     string;
  link?:    string;
  channels: ("in_app" | "email")[];
}

// ── Host service bridge (injected so plugins don't import core internals) ─────

/**
 * Services the host core provides to a plugin's server code. Populated by the
 * core plugin engine and exposed on `PluginContext.host`. Members are loosely
 * typed so the SDK stays dependency-free; first-party plugins may narrow them
 * locally (e.g. cast `prisma` to the generated client type).
 */
export interface PluginHost {
  /** The host Prisma client singleton. */
  prisma: any;
  /** BullMQ queue handles (plugins enqueue; the core worker processes). */
  queues: any;
  /** Validated host environment config. */
  env: any;
  /** Pino logger. */
  logger: any;
  /** Error primitives. */
  errors: {
    NodevoError: any;   // class — used as `new host.errors.NodevoError(...)`
    NEC: any;           // NEC code registry object
  };
  /** Express middleware provided by the host. */
  middleware: {
    requireAuth: any;
    optionalAuth: any;
    enforcePostLength: any;
    /** Factory: `requirePermission(key)` → middleware gating on a permission
     *  key (e.g. "admin.access"). Use for plugin ACP / privileged routes. */
    requirePermission: (key: string) => any;
  };
  /** Shared helper utilities. */
  utils: {
    resolveAvatar: (...args: any[]) => any;
    /** Sanitize user-authored rich-text HTML (allowlist) before storage.
     *  Plugins that accept HTML bodies MUST run them through this on write. */
    sanitizeRichText: (html: string) => string;
  };
  /** Core notification service — dispatch passes through all fields incl. meta. */
  notificationService: {
    dispatch: (opts: any) => Promise<void>;
  };
  /** Core moderation primitives for plugin security scans. */
  security: {
    /** Open a review case (dedup + notify case managers), identical to core
     *  security-analysis cases. `type` is a free string (e.g. "impossible_travel"). */
    createCase: (opts: { type: string; severity: "low" | "medium" | "high"; signals: string[]; userIds: string[] }) => Promise<void>;
    /** Permanently ban all non-staff, not-already-banned accounts in the set
     *  (system-attributed). Returns the banned usernames. Used by paid auto-ban. */
    autoBanMultiaccounts: (userIds: string[], reason: string) => Promise<string[]>;
  };
}

// ── Plugin context (injected into onEnable / onDisable) ───────────────────────

export interface NecCodeDeclaration {
  code:   string;  // e.g. "NEC-FORUM-6001"
  msg:    string;  // short display label
  sev:    "Info" | "Warning" | "Error" | "Critical";
  domain: string;  // shown as section header e.g. "Forum Plugin"
  desc:   string;  // what happened
  cause:  string;  // likely cause
  fix:    string;  // suggested resolution
}

export interface PluginContext {
  /** The plugin's id from the manifest. */
  pluginId: string;

  /** Host services (prisma, queues, middleware, errors, …) injected by core. */
  host: PluginHost;

  /** Register Express routes at /api/p/:pluginId/* */
  registerRoutes(router: PluginRouter): void;

  /** Register permission keys. Inserts into the permissions table. */
  registerPermissions(perms: PermissionDeclaration[]): Promise<void>;

  /** Register a frontend nav item. */
  registerNavItem(item: NavItemDeclaration): Promise<void>;

  /** Register ACP sidebar pages (returned by GET /api/admin/registered-pages). */
  registerAcpPage(page: AcpPageDeclaration): void;

  /** Register notification type strings for user preference UI. */
  registerNotificationTypes(types: string[]): void;

  /** Register a search content source (e.g. forum threads). Core asks it to run
   *  the search and merges results — it never queries the plugin's tables. */
  registerSearchSource(source: SearchSource): void;

  /** Register a home/guest feed content source (e.g. forum threads). */
  registerHomeFeedSource(source: HomeFeedSource): void;

  /** Register a site-stats source (e.g. forum thread/post totals) shown in the
   *  footer. Core aggregates registered sources — it never queries plugin tables.
   *  Deregistered automatically on plugin disable. */
  registerStatSource(source: StatSource): void;

  /** Register NEC error codes for the Error Reference ACP page. */
  registerNecCodes(codes: NecCodeDeclaration[]): void;

  /** Register a periodic security scan. Invoked by the core security-analysis
   *  job (every 30 min) after its built-in patterns. Use host.security.createCase
   *  to open review cases. Deregistered automatically on plugin disable. */
  registerSecurityScan(fn: () => Promise<void>): void;

  /** Declare that this plugin REPLACES the named core baseline detection
   *  patterns (§15 case types, e.g. "multi_account_suspicion"): core skips its
   *  built-in version while the plugin is enabled — the plugin's registered
   *  scan is expected to cover the pattern (usually an enhanced variant).
   *  Claims are released automatically on disable, restoring the baseline. */
  claimSecurityPatterns(patterns: string[]): void;

  /** Dispatch a notification through the core notification service. */
  notify(opts: NotifyOptions): Promise<void>;
}

// ── Plugin definition — what a plugin exports from its server entry ───────────

export interface PluginDefinition {
  /** Must match manifest.id */
  id: string;

  onEnable(ctx: PluginContext): void | Promise<void>;
  onDisable?(ctx: PluginContext): void | Promise<void>;
}

// ── Re-export for convenience ─────────────────────────────────────────────────
// Plugin authors import from their local express; the SDK just provides the contract.

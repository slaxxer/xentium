/**
 * @xentium/plugin-sdk
 *
 * The authoring contract for Xentium CMS plugins. Import this in your plugin's
 * server entry point.
 *
 * ── What changed, and what did not ─────────────────────────────────────────
 *
 * The application-agnostic half of this contract now lives in
 * `@xentium/plugin-kit` — manifest, definition, host bridge and the base context
 * — so that a plugin for a DIFFERENT Xentium-framework application (the
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
} from "@xentium/plugin-kit";

// Everything application-agnostic, re-exported so one import still suffices.
export type {
  PluginRouter,
  PluginManifest,
  PermissionDeclaration,
  XecCodeDeclaration,
  NotifyOptions,
} from "@xentium/plugin-kit";

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
  /** `badgeColor` is filled in by core from the username; a source need not send it. */
  author?:        { username: string; avatar: string | null; badgeColor?: string | null } | null;
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
  /** `badgeColor` is filled in by core from the username; a source need not send it. */
  author?:        { username: string; avatar: string | null; badgeColor?: string | null } | null;
  metric?:        number;                   // primary count shown in the votes box (likes/replies)
  metricLabel?:   string;                   // e.g. "likes" | "replies"
  replies?:       number;
  views?:         number;
  createdAt:      string;                   // ISO timestamp — used to merge sources by recency
}

/**
 * What core needs to know about a piece of a plugin's content that was REPORTED.
 *
 * A plugin files reports through core's `POST /moderation/reports` with
 * `targetType: "plugin-content"` and `targetId: "<pluginId>:<kind>:<id>"`. Core cannot
 * read the plugin's tables, so without this a moderator saw only the reason: no
 * author to warn or ban, no snapshot, no link to the content.
 */
export interface ReportTargetInfo {
  /** The member who wrote it — makes Warn and Ban possible. */
  authorId: string | null;
  /** A plain-text copy of what it said, kept with the report. */
  snapshot: string | null;
  /** Where it is, as a moderator reads it — e.g. the thread title. */
  where:    string | null;
  /** A site-relative link that shows it, e.g. `/forum/thread/<slug>?page=2`. The page
   *  should carry `data-mod-target="plugin-content:<targetId>"` on the item itself, so
   *  ModCanvas can scroll to it and mark it. */
  href:     string | null;
}

/** A kind of plugin content that can be reported (`registerReportTarget`). */
export interface ReportTargetHandler {
  /** The middle part of the target id — `"post"` in `"xentium-forum:post:<id>"`. */
  kind: string;
  /** Describe one item; null when it no longer exists. */
  describe(id: string): Promise<ReportTargetInfo | null>;
  /** Remove it (soft delete), on a moderator's behalf. Omit when it cannot be removed
   *  from a report; ModCanvas then does not offer Remove. */
  remove?(id: string, by: { actorId: string; reason: string }): Promise<void>;
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

/** Something a badge can be earned for, contributed by a plugin. */
export interface BadgeCriteria {
  /** Namespaced with the plugin's own prefix, e.g. `forum.posts`. */
  key: string;
  /** Doubles as a translation key and as the fallback text — keep it readable. */
  label: string;
  /** The member's current value. Core holds the threshold and does the comparing. */
  valueFor(userId: string): Promise<number>;
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

// ── Auth guards (§43) ────────────────────────────────────────────────────────

/** What a guard is told about the request. Primitives only: a guard must not be
 *  handed Express, or it could rewrite the response. */
export interface AuthGuardRequest {
  ip:        string;
  userAgent: string | null;
  /** Signed cookies, so a guard can read its own (e.g. an invite cookie). */
  cookies:   Record<string, string>;
}

/** What a guard may add to `GET /auth/registration-status`. */
export interface RegistrationStatusPatch {
  open?:        boolean;
  mode?:        string;
  /** Heading + body shown when registration is closed, so the wording belongs to
   *  the plugin enforcing the policy rather than to core. */
  closedTitle?: string;
  closedBody?:  string;
}

/**
 * A gate on authentication.
 *
 * Core owns identity — passwords, sessions, tokens, groups. It does not own the
 * question "is this person allowed in right now", which is a POLICY: a private
 * beta, an allow-list, a paid seat. Implement only the moments you care about.
 *
 * Refuse by THROWING a `XentiumError`. A guard never returns a boolean, because a
 * refusal carries the XEC code and the message the client shows, and those
 * belong to whoever knows why the answer was no.
 *
 * `beforeLogin` and `beforeRegister` propagate their error — that is the point.
 * The bookkeeping hooks are fire-and-forget: a failure there is logged and never
 * unwinds an account that already exists.
 */
/** `"allow"` = this guard authorised the action; core's own policy is skipped. */
export type AuthGuardDecision = "allow";

export interface AuthGuard {
  id: string;
  /** Staff are passed too — YOUR policy decides whether to exempt them. */
  beforeLogin?(req: AuthGuardRequest & { userId: string; isStaff: boolean }): Promise<void>;
  /**
   * Runs before any row is written.
   *
   * Return `"allow"` to AUTHORISE the registration outright — core then skips its
   * own `auth.registration_mode` gate. A private beta where the invite is the
   * credential needs this: it must work on a site whose registration is
   * otherwise closed. Return nothing to express no opinion.
   */
  beforeRegister?(req: AuthGuardRequest): Promise<AuthGuardDecision | void>;
  /** The account now exists — link it to whatever let them in. */
  afterRegister?(req: AuthGuardRequest & { userId: string }): Promise<void>;
  /** For your own audit trail. */
  afterLogin?(req: AuthGuardRequest & { userId: string; isStaff: boolean }): Promise<void>;
  /** Contribute to the registration-status endpoint; return null to abstain. */
  registrationStatus?(req: AuthGuardRequest): Promise<RegistrationStatusPatch | null>;
  /** Cookie names core clears on logout, so you never need the response object. */
  cookiesToClearOnLogout?: string[];
}

// ── Embeds + content visibility ──────────────────────────────────────────────

/** A piece of written content that can hold embeds (a forum post, an article). */
export interface EmbedHost {
  /** The content's kind as registered with `registerContentKind` — `forum.post`, `article`. */
  kind:     string;
  id:       string;
  /** Who wrote it. An embed should attach only items its own writer created. */
  authorId: string;
}

/**
 * Your items shown INSIDE someone else's content — a poll in a post. The content
 * stores a placeholder (`<div data-xt-embed="poll" data-id="…">`, see
 * `@xentium/contracts` `extractEmbeds`); the web side renders it through
 * `slotRegistry.registerEmbed`.
 *
 * Core calls `sync` every time a host is saved, with the ids of YOUR type it now
 * holds — possibly none, so you can release what the writer deleted — and
 * `remove` when the host is gone for good. Both must be idempotent; a failure is
 * logged and never fails the member's save.
 */
export interface EmbedHandler {
  /** Lowercase letters, digits and dashes; one plugin per type. */
  type:   string;
  sync:   (host: EmbedHost, ids: string[]) => Promise<unknown>;
  remove: (host: { kind: string; id: string }) => Promise<void>;
}

/**
 * Answer "may this viewer see that item of yours?" for one kind of your content,
 * so an embed inside it is exactly as visible as the content itself.
 *
 * ⚠ Answer FALSE whenever unsure: core treats an error as false too, and the
 * asker shows a not-found. Every rule your own read path applies (deleted,
 * unapproved, private board, blocked author) belongs here as well.
 */
export interface ContentKindHandler {
  /** Namespaced with your plugin: `forum.post`. */
  kind:    string;
  canView: (id: string, viewerId: string | null) => Promise<boolean>;
}

// ── Host bridge ──────────────────────────────────────────────────────────────

/**
 * The CMS's host bridge: everything `@xentium/plugin-kit` guarantees (prisma,
 * queues, env, logger, errors, middleware, cron), plus what only a community
 * platform can offer.
 */
export interface PluginHost extends BasePluginHost {
  /**
   * Progression primitives (§38). Core owns the ladder; a plugin owns the
   * thresholds and limits for its own content, keyed by the group id this
   * returns.
   */
  /**
   * Ask whether a user holds a permission (implied permissions included) — the same
   * answer `middleware.requirePermission` acts on, for code that must decide rather
   * than refuse. OPTIONAL: older hosts do not provide it, so check before calling.
   */
  permissions?: {
    has: (userId: string, key: string) => Promise<boolean>;
  };
  /**
   * Content visibility and embeds (see `EmbedHandler`, `ContentKindHandler`).
   * OPTIONAL: older hosts do not provide it — and then an embed must stay hidden.
   */
  content?: {
    /** Fails closed: unknown kind, disabled owner or an error is `false`. */
    canView:      (kind: string, id: string, viewerId: string | null) => Promise<boolean>;
    /** Call after saving content that may hold embeds (HTML or ProseMirror JSON). */
    syncEmbeds:   (host: EmbedHost, content: unknown) => Promise<void>;
    /** Call when content is deleted for good. */
    removeEmbeds: (host: { kind: string; id: string }) => Promise<void>;
  };
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
     *  (system-attributed). Returns the banned usernames. Used by paid auto-ban.
     *  `textKey` (optional): the member's notification as a translation in your
     *  namespace (`"advmod:notify.autoBan"`, with .title/.body). */
    autoBanMultiaccounts: (userIds: string[], reason: string, textKey?: string) => Promise<string[]>;
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

  /** Describe (and optionally remove) a kind of this plugin's content when it is
   *  reported, so ModCanvas can show it, link to it and act on its author.
   *  Deregistered on disable. Optional on older cores — call it as
   *  `ctx.registerReportTarget?.(…)`. */
  registerReportTarget?(handler: ReportTargetHandler): void;

  /** Show your items inside other content (a poll in a post). Deregistered on
   *  disable. Optional on older cores: `ctx.registerEmbed?.(…)`. */
  registerEmbed?(handler: EmbedHandler): void;

  /** Own a kind of content for `host.content.canView` (and so for embeds inside
   *  it). Deregistered on disable — embeds in it then stay hidden. Optional on
   *  older cores: `ctx.registerContentKind?.(…)`. */
  registerContentKind?(handler: ContentKindHandler): void;

  /** Register a site-stats source shown in the footer. Deregistered on disable. */
  registerStatSource(source: StatSource): void;

  /** Register progression promotion criteria (§38). A disabled plugin's criteria
   *  stop counting. The admin UI for its thresholds belongs in the core Group
   *  settings dialog via the web-side `groupConfigPanel` slot, and autosaves —
   *  see `docs/plugin-acp-autosave.md`. */
  registerProgressionCriteria(criteria: ProgressionCriteria): void;
  /**
   * Something a BADGE can be earned for — e.g. the forum's posts and threads.
   *
   * ⚠ Different from `registerProgressionCriteria`, which answers yes/no against a
   * ladder GROUP's own thresholds. A badge keeps its thresholds on the badge, so all
   * a plugin does here is report the member's current NUMBER and let core compare.
   *
   * Registered in `onEnable` and dropped on disable: while the plugin is off the
   * metric is not offered to admins and not evaluated, and any threshold already
   * stored against it is left untouched and starts counting again on re-enable.
   */
  registerBadgeCriteria(metric: BadgeCriteria): void;

  /** Open one of this plugin's own pages to the layout editor (ADR-0005).
   *  Throws on a declaration core will not accept, failing the enable rather
   *  than half-registering. Deregistered on disable — stored layouts are KEPT,
   *  so re-enabling restores them. */
  registerLayoutTemplate(template: LayoutTemplateDeclaration): void;

  /** Gate authentication (§43). Core owns identity; a guard owns the policy that
   *  decides whether a given person may log in or register right now. Refuse by
   *  throwing. Deregistered on disable — a disabled gate must stop gating, or an
   *  admin who turns a beta off by disabling its plugin locks everyone out. */
  registerAuthGuard(guard: AuthGuard): void;

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

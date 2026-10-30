/**
 * @xentium/plugin-kit — the application-agnostic half of the plugin contract.
 *
 * The plugin ENGINE (`@xentium/plugin-engine`) is framework: it validates
 * manifests, runs migrations, mounts routers, and knows nothing about what the
 * host application is for. This package is the matching contract — the shapes a
 * plugin and its host agree on, with nothing in them that assumes a CMS.
 *
 * What is NOT here, and never will be: anything that presumes what the host
 * serves. Search sources, home feeds, progression ladders, layout templates and
 * ACP pages are all Xentium CMS concepts and live in `@xentium/plugin-sdk`, which
 * extends everything below.
 *
 * ── Which package should a plugin import? ──────────────────────────────────
 *
 * Almost always `@xentium/plugin-sdk`. It re-exports this one in full and adds
 * the CMS surface, so a Xentium CMS plugin gets everything from a single import.
 *
 * Import THIS package directly only when writing a plugin for a different
 * Xentium-framework application — the marketplace, say — or when writing tooling
 * that handles plugins for any host.
 */

// ── Routing ──────────────────────────────────────────────────────────────────

/** Structural, so this package needs no dependency on express. Express's Router satisfies it. */
export interface PluginRouter {
  use: (...args: any[]) => any;
  get: (...args: any[]) => any;
  post: (...args: any[]) => any;
  patch: (...args: any[]) => any;
  put: (...args: any[]) => any;
  delete: (...args: any[]) => any;
}

// ── Manifest ─────────────────────────────────────────────────────────────────

export interface PluginManifest {
  id:               string;        // kebab-case, unique e.g. "xentium-forum"
  name:             string;
  version:          string;        // semver
  vendor:           string;
  minXentiumVersion: string;
  maxXentiumVersion?: string;
  licenseRequired:  boolean;
  /** When set, every DB object this plugin's migrations touch MUST carry it. */
  tablePrefix?:     string;
  permissions:      string[];
  migrations:       string[];      // migration names (without .up/.down.sql)
  entrypoints: {
    server?: string;
    web?:    string;
  };
}

// ── Declarations ─────────────────────────────────────────────────────────────

export interface PermissionDeclaration {
  key:      string;                // e.g. "forum.thread.create"
  label:    string;
  domain:   string;                // grouping label in the host's admin UI
  defaults?: string[];             // group keys granted this on first install
}

export interface XecCodeDeclaration {
  code:   string;  // e.g. "XEC-FORUM-6001"
  msg:    string;
  sev:    "Info" | "Warning" | "Error" | "Critical";
  domain: string;
  desc:   string;
  cause:  string;
  fix:    string;
}

export interface NotifyOptions {
  userId:   string;
  type:     string;
  title:    string;
  body:     string;
  link?:    string;
  channels: ("in_app" | "email")[];
  /** The text as a translation key in the plugin's namespace (`"forum:notify.approved"`): the bell
   *  shows `<key>.title` / `<key>.body` in the reader's language; title/body stay the fallback. */
  i18n?:    { key: string; params?: Record<string, string | number> };
}

// ── Host bridge ──────────────────────────────────────────────────────────────

/**
 * Services every host provides, whatever it serves.
 *
 * Loosely typed on purpose: this package stays dependency-free, so a host that
 * wants stronger types narrows them locally (casting `prisma` to its own
 * generated client, for instance). An application extends this interface with
 * whatever else it offers.
 */
export interface PluginHost {
  /** The host's database client. */
  prisma: any;
  /**
   * The host's database connection pool (a node-postgres `Pool`), for a plugin that
   * brings its own client: `new PrismaClient({ adapter: new PrismaPg(host.pg as Pool) })`,
   * Drizzle, Kysely or plain `pg`. Shared with the host, so never `end()` it. Tables
   * are still created only by the plugin's SQL migrations. Absent on an older host.
   */
  pg?: unknown;
  /** Job queue handles. Plugins enqueue; the host's worker processes. */
  queues: any;
  /** Validated host environment config. */
  env: any;
  /** Structured logger. */
  logger: any;
  errors: {
    XentiumError: any;
    XEC: any;
  };
  middleware: {
    requireAuth: any;
    optionalAuth: any;
    /** `requirePermission(key)` → middleware gating on a permission key. */
    requirePermission: (key: string) => any;
    /**
     * Ask a signed-in member with two-factor sign-in on for a fresh code before the
     * request runs (mount AFTER requireAuth, before any upload parser). The browser
     * answers the 403 by asking for the code and repeating the request. Passes
     * straight through for a member without 2FA. Absent on an older host.
     */
    requireStepUp?: any;
  };
  utils: {
    /**
     * Cron maths for plugins running their own recurring jobs. The host does
     * NOT manage or display a plugin's schedules — the plugin still calls
     * `upsertJobScheduler` in `onEnable` and removes it on disable. This only
     * stops every plugin re-implementing cron parsing and its guardrails.
     */
     cron: {
      resolveCron: (
        cfg: { mode: "interval" | "daily" | "cron"; intervalMin?: number; dailyTime?: string; cron?: string; tz?: string },
        fallbackCron: string,
      ) => string;
      previewRuns: (pattern: string, tz: string | undefined, minIntervalSec: number, count?: number) => string[];
    };
    /**
     * Encrypt / decrypt a secret a plugin must store (an API key, a client secret)
     * with the host's secret box, so it never sits in the database in clear text.
     */
    encryptSecret: (value: string) => string;
    decryptSecret: (value: string) => string;
  };
  /**
   * Put a member into a group, or take them out, with their permissions applied at
   * once (the host clears its permission cache). For grants such as a paid
   * membership. Refuses any group that holds `admin.access`: a plugin never makes
   * someone an administrator.
   */
  groups: {
    add: (userId: string, groupId: string) => Promise<void>;
    remove: (userId: string, groupId: string) => Promise<void>;
    /**
     * A group your plugin needs, by key: created the first time (with no permissions,
     * the name and badge colour you give), its id returned after that. Once it exists
     * it is the admin's: renamed or recoloured in ACP → Groups and never overwritten.
     */
    ensure: (spec: { key: string; name: string; badgeColor?: string; nameGlow?: boolean; displayOrder?: number }) => Promise<string>;
  };
}

// ── Context ──────────────────────────────────────────────────────────────────

/**
 * What every host hands a plugin at enable time.
 *
 * Generic over the host bridge so an application can widen it: the Xentium CMS
 * passes a host carrying progression and moderation primitives, and its
 * `PluginContext` reflects that without this package knowing either exists.
 */
export interface PluginContext<Host extends PluginHost = PluginHost> {
  /** The plugin's id, from its manifest. */
  pluginId: string;

  /** Host services. */
  host: Host;

  /** Mount Express routes at the host's plugin prefix (`/api/p/:pluginId/*`). */
  registerRoutes(router: PluginRouter): void;

  /** Declare permission keys. */
  registerPermissions(perms: PermissionDeclaration[]): Promise<void>;

  /** Declare XEC error codes, for the host's error reference. */
  registerNecCodes(codes: XecCodeDeclaration[]): void;

  /** Dispatch a notification through the host. */
  notify(opts: NotifyOptions): Promise<void>;
}

// ── Definition ───────────────────────────────────────────────────────────────

/**
 * What a plugin's server entry exports.
 *
 * Generic over the context so an application's SDK can bind it to its own
 * richer context — a CMS plugin's `onEnable` then sees the CMS registrations
 * without this package declaring them.
 */
export interface PluginDefinition<Ctx = PluginContext> {
  /** Must match `manifest.id`. */
  id: string;

  onEnable(ctx: Ctx): void | Promise<void>;
  onDisable?(ctx: Ctx): void | Promise<void>;
}

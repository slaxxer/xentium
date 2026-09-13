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
  id:               string;        // kebab-case, unique e.g. "nodevo-forum"
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

export interface NecCodeDeclaration {
  code:   string;  // e.g. "NEC-FORUM-6001"
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
  /** Job queue handles. Plugins enqueue; the host's worker processes. */
  queues: any;
  /** Validated host environment config. */
  env: any;
  /** Structured logger. */
  logger: any;
  errors: {
    XentiumError: any;
    /**
     * @deprecated Pre-rename alias for `XentiumError`, kept so plugin bundles built
     * against the Nodevo host keep working. Removed after 1.0.0-alpha.
     */
    NodevoError: any;
    NEC: any;
  };
  middleware: {
    requireAuth: any;
    optionalAuth: any;
    /** `requirePermission(key)` → middleware gating on a permission key. */
    requirePermission: (key: string) => any;
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

  /** Declare NEC error codes, for the host's error reference. */
  registerNecCodes(codes: NecCodeDeclaration[]): void;

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

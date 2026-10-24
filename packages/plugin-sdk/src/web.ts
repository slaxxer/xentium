/**
 * @xentium/plugin-sdk/web — the browser half of the plugin contract, as types.
 *
 * A plugin's web bundle runs inside the site and reaches core through ONE global,
 * `window.__XENTIUM_HOST__`, never by importing core's code: the host's React, its
 * router, its query client and its components are the ones the page already runs,
 * so a plugin's UI looks, themes and behaves like core's.
 *
 *   import { xentiumHost } from "@xentium/plugin-sdk/web";
 *   const host = xentiumHost();
 *   host.webSlotRegistry.slotRegistry.registerRoute({ path: "/gallery", layout: "public", component: GalleryPage });
 *
 * In your build, mark `react`, `react-dom`, `react-router-dom` and
 * `@tanstack/react-query` as externals mapped to the host's copies (the generator's
 * vite config does this): two copies of React on one page break hooks.
 *
 * These types cover the members a plugin uses most and that are part of the 1.x
 * promise. The global carries more (rich editors, moderation helpers); those are
 * typed loosely here and may change in a minor.
 */

/** A component, from whichever React the plugin builds against. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HostComponent<P = any> = (props: P) => unknown;

// ── Events ───────────────────────────────────────────────────────────────────

export interface HostEventMap {
  /** The page changed (any navigation, including the first). */
  "route.changed": { path: string; search: string };
  /** Someone signed in, out, or the session was restored. `userId` null = a guest. */
  "auth.changed": { userId: string | null };
}

// ── Slots: where a plugin's UI goes ──────────────────────────────────────────

export interface PluginRouteSlot {
  /** `/gallery/:id` for a public page; `/admin/gallery` (no leading "/admin" twice) for an ACP page. */
  path: string;
  component: HostComponent;
  layout: "public" | "acp";
  /** Public pages only: members only (guests are sent to sign in). */
  requiresAuth?: boolean;
}

export interface SlotRegistry {
  /** Say which plugin the next registrations belong to; call first. */
  registerPluginMeta(meta: { pluginId: string; acpIcon?: string; icon?: unknown; acpSectionPosition?: "after-content" }): void;
  registerRoute(route: PluginRouteSlot): void;
  /** A tab on member profiles. */
  registerProfileTab(slot: { id: string; label: string; component: HostComponent<{ profileId: string; profileUsername: string; isOwn: boolean }> }): void;
  /** A section in the member's own Account page. */
  registerAccountSection(slot: { id: string; label: string; component: HostComponent }): void;
  /** A section in Account → Privacy. */
  registerPrivacySection(slot: { id: string; component: HostComponent }): void;
  /** A section in ACP → Settings. */
  registerSettingsSection(slot: { id: string; label: string; description?: string; component: HostComponent; order?: number }): void;
  /** Your own field on the sign-up form; its value reaches your `registration.validate` filter and `user.registered` listener as `addons["<your id>"]`. */
  registerRegistrationField(slot: { id: string; order?: number; component: HostComponent<{ value: unknown; onChange: (value: unknown) => void }> }): void;
  /** Beside the notification bell, for signed-in members. */
  registerHeaderWidget(slot: { id: string; component: HostComponent<{ icon?: string }>; order?: number; label?: string }): void;
  /** An entry in the signed-in member's menu. */
  registerUserMenuItem(slot: { id: string; label: string; to: string; icon?: unknown; order?: number }): void;
  /** Drawn once on every public page, outside the layout (a chat bubble). */
  registerSiteOverlay(slot: { id: string; component: HostComponent; order?: number }): void;
}

// ── The host ─────────────────────────────────────────────────────────────────

export interface HostApi {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string, body?: unknown): Promise<T>;
}

export interface UploaderProps {
  /** Your upload route under /api: `/p/<pluginId>/…` (it calls `host.files.save`). */
  url: string;
  field?: string;
  /** Kinds (`image`, `pdf`, `archive`, `audio`, `video`, `document`) or extensions. */
  accept?: string[];
  maxBytes?: number;
  multiple?: boolean;
  extra?: Record<string, string>;
  onUploaded?: (result: unknown, file: { name: string; size: number; type: string }) => void;
  label?: string;
  disabled?: boolean;
}

/** What a block panel gets: the selected block, and the theme's site-wide tokens. */
export interface BlockPanelProps {
  block: { id: string; type: string; props: Record<string, unknown> };
  templateKey: string;
  /** The theme's site-wide tokens as the draft has them. */
  themeTokens: Record<string, string>;
  /** Stage tokens in the theme's draft; `null` clears one. Live with Publish. */
  setThemeTokens(tokens: Record<string, string | null>): void;
}

export interface BlockPanel {
  /** `<namespace>.<name>`. */
  id: string;
  pluginId: string;
  /** The block types it shows on. */
  blockTypes: readonly string[];
  /** The fold's title, in the admin's language. */
  title(): string;
  /** Marks the fold as in use. */
  active?(themeTokens: Record<string, string>): boolean;
  Panel: HostComponent<BlockPanelProps>;
}

export interface XentiumWebHost {
  /** The page's own React, router and query client: use these, never bundle your own. */
  React: unknown;
  ReactRouterDom: unknown;
  ReactQuery: unknown;
  ReactI18next: unknown;
  /** Calls to `/api/…` with the member's session (and a token refresh when needed). */
  webApi: { api: HostApi };
  webSlotRegistry: { slotRegistry: SlotRegistry };
  /** Follow the page and the signed-in member. Returns an unsubscribe. */
  events: { on<K extends keyof HostEventMap>(event: K, fn: (payload: HostEventMap[K]) => void): () => void };
  /** Your settings marked `.meta({ public: true })`, as a react-query result. */
  webPluginSettings: { usePublic<T = Record<string, unknown>>(pluginId: string): { data?: T; isLoading: boolean; error: unknown } };
  /** Drag-and-drop upload with progress, to your own route. */
  webUploader: { Uploader: HostComponent<UploaderProps> };
  /**
   * Settings on the blocks they belong to, in Theme Studio (core 1.0.0-alpha.20+).
   * A panel stages site-wide theme tokens; see docs/plugin-blocks.md, "Settings on
   * someone else's block".
   */
  webBlockPanels?: {
    registerBlockPanel(panel: BlockPanel): void;
    deregisterBlockPanelsFor(pluginId: string): void;
  };
  /** Small messages in the corner. */
  webToast: { toast: { success(message: string): void; info(message: string): void; warning(message: string): void; error(message: string): void } };
  /** A confirm or alert dialog; resolves true when confirmed. */
  webDialog: { openDialog(opts: { kind: "confirm" | "alert"; icon: "question" | "success" | "info" | "warning" | "error"; title: string; body?: string; confirmText?: string; cancelText?: string; danger?: boolean }): Promise<boolean> };
  /** Dates and times in the site's zone and format. */
  webDateTime: Record<string, unknown>;
  /** Member names, avatars and badges drawn exactly like core's. */
  webUsername: { Username: HostComponent<{ username: string; badgeColor?: string | null; href?: string; className?: string }> };
  webUserAvatar: { UserAvatar: HostComponent<{ user: { username: string; avatar?: string | null }; size?: number; className?: string }> };
  /** ACP form controls (Button, Toggle, TextField, NumberStepper): one look across the ACP. */
  webAcpControls: Record<string, HostComponent>;
  /** Layout blocks: what admins place on pages in Theme Studio. */
  webBlockRegistry: { registerBlock(def: unknown): void };
  /** The host's Zod 4 (block schemas, forms). */
  Zod: unknown;
  /** Everything else the global carries; typed loosely, may change in a minor. */
  [member: string]: unknown;
}

declare global {
  interface Window {
    __XENTIUM_HOST__?: unknown;
  }
}

/** The host, typed. Throws when the page has none (the bundle was opened outside a Xentium site). */
export function xentiumHost(): XentiumWebHost {
  const host = (globalThis as { __XENTIUM_HOST__?: unknown }).__XENTIUM_HOST__;
  if (!host) throw new Error("No Xentium host on this page: load this plugin inside a Xentium site.");
  return host as XentiumWebHost;
}

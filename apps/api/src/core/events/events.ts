import type { CoreEventMap, CoreFilterMap, FilterHandler, FilterRefusal } from "@xentium/plugin-sdk";
import { XEC } from "@xentium/contracts";
import { XentiumError } from "@xentium/errors";
import { logger } from "../../infrastructure/logging/logger.js";

/**
 * Events and filters (ADR-0011 §1): what lets a plugin react to core, and at a few
 * chosen points change or refuse what core does, without a core release per idea.
 *
 * EVENTS are announced AFTER the change is committed and run AFTER the caller has
 * moved on (`setImmediate`): a listener can never slow a request, fail it, or see
 * a change that was rolled back. Each listener runs isolated — an error is logged
 * with the plugin's name, a listener still going after 5 s is abandoned. Listeners
 * run in the process that emitted (each process loads every plugin), so an event
 * is handled once. Heavy work belongs in a job.
 *
 * FILTERS run INSIDE the action, in plugin load order, each seeing the previous
 * result. A filter that throws or takes over 2 s counts as "no change": a broken
 * plugin must not lock members out of signing up.
 */

const LISTENER_LIMIT_MS = 5_000;
const FILTER_LIMIT_MS = 2_000;

type AnyFn = (input: never, meta: never) => unknown;
interface Entry { pluginId: string; fn: AnyFn }

const listeners = new Map<string, Entry[]>();
const filters = new Map<string, Entry[]>();

/** A namespaced event name: `user.registered`, `xentium-forum.thread.created`. */
const EVENT_NAME = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-zA-Z0-9-]*)+$/;

export function addListener(pluginId: string, event: string, fn: AnyFn): void {
  if (!EVENT_NAME.test(event)) throw new Error(`[events] "${event}" is not an event name.`);
  if (typeof fn !== "function") throw new Error(`[events] the listener for "${event}" is not a function.`);
  const list = listeners.get(event) ?? [];
  list.push({ pluginId, fn });
  listeners.set(event, list);
}

export function addFilter<K extends keyof CoreFilterMap>(pluginId: string, name: K, fn: FilterHandler<K>): void {
  if (!FILTER_NAMES.has(name)) throw new Error(`[filters] "${name}" is not a filter core offers.`);
  if (typeof fn !== "function") throw new Error(`[filters] the filter for "${name}" is not a function.`);
  const list = filters.get(name) ?? [];
  list.push({ pluginId, fn: fn as AnyFn });
  filters.set(name, list);
}

/** A plugin's listeners and filters go (disable, update). */
export function deregisterEvents(pluginId: string): void {
  for (const map of [listeners, filters]) {
    for (const [k, list] of map) {
      const kept = list.filter((e) => e.pluginId !== pluginId);
      if (kept.length) map.set(k, kept); else map.delete(k);
    }
  }
}

function withLimit<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(`gave up after ${ms} ms`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

async function runListeners(event: string, payload: unknown): Promise<void> {
  const list = listeners.get(event);
  if (!list?.length) return;
  const meta = { event, at: new Date().toISOString() };
  await Promise.all(list.map(async ({ pluginId, fn }) => {
    try {
      await withLimit(Promise.resolve().then(() => (fn as (p: unknown, m: unknown) => unknown)(payload, meta)), LISTENER_LIMIT_MS);
    } catch (err) {
      logger.warn({ pluginId, event, err: err instanceof Error ? err.message : String(err) }, "Plugin event listener failed");
    }
  }));
}

/**
 * Announce a core event. Call it AFTER the change is committed. Returns at once;
 * the listeners run on the next turn.
 */
export function emit<K extends keyof CoreEventMap>(event: K, payload: CoreEventMap[K]): void {
  emitAny(event, payload);
}

/** `user.groupsChanged` from the groups before and after; nothing when they match. */
export function emitGroupsChanged(userId: string, before: string[], after: string[]): void {
  const added = after.filter((g) => !before.includes(g));
  const removed = before.filter((g) => !after.includes(g));
  if (added.length || removed.length) emit("user.groupsChanged", { userId, added, removed });
}

/** Any event name, a plugin's own included (`ctx.emit`). */
export function emitAny(event: string, payload: unknown): void {
  if (!listeners.get(event)?.length) return;
  setImmediate(() => { void runListeners(event, payload); });
}

/** For tests: wait for an event's listeners right now. */
export function _emitAndWait(event: string, payload: unknown): Promise<void> {
  return runListeners(event, payload);
}

// ── Filters ─────────────────────────────────────────────────────────────────

/** The filters core offers, with what each may do. Grows in minors, never shrinks in 1.x. */
const FILTER_NAMES = new Set<string>([
  "registration.validate",
  "article.validate",
  "comment.validate",
  "notification.validate",
  "profile.extra",
]);

/**
 * A VALIDATE filter: every plugin may refuse, the first refusal wins and stops the
 * run. Returns the refusal, or null to go ahead.
 */
export async function validate<K extends keyof CoreFilterMap>(
  name: K, input: CoreFilterMap[K]["input"],
): Promise<(FilterRefusal & { pluginId: string }) | null> {
  for (const { pluginId, fn } of filters.get(name) ?? []) {
    try {
      const out = await withLimit(Promise.resolve().then(() => (fn as (i: unknown) => unknown)(input)), FILTER_LIMIT_MS) as FilterRefusal | void | null | undefined;
      if (out && typeof out === "object" && typeof out.refuse === "string" && out.refuse) {
        return { refuse: out.refuse, params: out.params, pluginId };
      }
    } catch (err) {
      logger.warn({ pluginId, filter: name, err: err instanceof Error ? err.message : String(err) }, "Plugin filter failed — ignored");
    }
  }
  return null;
}

/**
 * A CONTRIBUTE filter: each plugin returns its own piece, collected under its id
 * (`{ "<pluginId>": … }`). A plugin can add to a response but never change or hide
 * what core or another plugin put there.
 */
export async function contribute<K extends keyof CoreFilterMap>(
  name: K, input: CoreFilterMap[K]["input"],
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const { pluginId, fn } of filters.get(name) ?? []) {
    try {
      const v = await withLimit(Promise.resolve().then(() => (fn as (i: unknown) => unknown)(input)), FILTER_LIMIT_MS);
      if (v !== undefined && v !== null) out[pluginId] = v;
    } catch (err) {
      logger.warn({ pluginId, filter: name, err: err instanceof Error ? err.message : String(err) }, "Plugin filter failed — ignored");
    }
  }
  return out;
}

/**
 * Run a VALIDATE filter and stop the action on a refusal: 422 XEC-PLUGIN-4220,
 * with the plugin's message key so the site shows the plugin's own words.
 */
export async function assertAllowed<K extends keyof CoreFilterMap>(name: K, input: CoreFilterMap[K]["input"]): Promise<void> {
  const refusal = await validate(name, input);
  if (!refusal) return;
  throw new XentiumError({
    code: XEC.PLUGIN_REFUSED, httpStatus: 422, persist: false,
    message: `Refused by ${refusal.pluginId} (${name})`,
    details: { key: refusal.refuse, params: refusal.params ?? {}, pluginId: refusal.pluginId, filter: name },
  });
}

/** Rich text (HTML) as the plain text a filter sees. */
export function plainForFilter(html: string): string {
  return html.replace(/<(br|\/p|\/li|\/h[1-6])\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .trim();
}

export function hasFilters(name: string): boolean {
  return !!filters.get(name)?.length;
}

/** For tests. */
export function _resetEvents(): void {
  listeners.clear();
  filters.clear();
}

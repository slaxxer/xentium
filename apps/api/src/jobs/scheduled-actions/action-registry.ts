/**
 * Core scheduled-action registry.
 *
 * An admin-created task is `action key + validated params + schedule`. Core runs
 * ONLY handlers registered here — there is no arbitrary-code path, by design: a
 * scheduler that can execute admin-supplied code turns any admin-session
 * compromise into server compromise.
 *
 * This registry is deliberately CORE-INTERNAL and not exposed through the plugin
 * SDK. A plugin owns its own cron jobs end to end (it schedules them itself in
 * onEnable), so a task can never reference a handler that vanishes when a plugin
 * is disabled. Plugins may borrow the cron maths via `host.utils.cron`.
 */
import type { ZodType } from "zod";

/** What a run reports back. `changed` drives the ACP summary line. */
export interface ActionResult {
  /** Rows actually written (0 in dry-run, even when drift was found). */
  changed: number;
  /** One-line human summary, shown in the run history. */
  summary: string;
}

export interface ActionRunCtx {
  /** When true the action MUST NOT write — only report what it would do. */
  dryRun: boolean;
  taskId: string;
}

export interface ScheduledActionDef<P = any> {
  key:         string;   // e.g. "system.recompute-counters"
  label:       string;
  description: string;
  domain:      string;   // groups the ACP action picker
  /** Params contract. Validated when the task is SAVED and again before EVERY
   *  run — a task can outlive a schema change, and that should fail loudly on
   *  one run rather than silently do the wrong thing forever. */
  params:      ZodType<P>;
  /** Floor for this action's schedule, on top of the global one. "Prune 2M rows"
   *  and "send a digest" do not deserve the same minimum. */
  minIntervalSec: number;
  /** True when the action can destroy data — the ACP warns, and dry-run is
   *  offered prominently. */
  destructive?: boolean;
  run(params: P, ctx: ActionRunCtx): Promise<ActionResult>;
}

const actions = new Map<string, ScheduledActionDef>();

export function registerScheduledAction<P>(def: ScheduledActionDef<P>): void {
  actions.set(def.key, def as ScheduledActionDef);
}

export function getAction(key: string): ScheduledActionDef | undefined {
  return actions.get(key);
}

export function listActions(): ScheduledActionDef[] {
  return [...actions.values()].sort((a, b) =>
    a.domain.localeCompare(b.domain) || a.label.localeCompare(b.label));
}

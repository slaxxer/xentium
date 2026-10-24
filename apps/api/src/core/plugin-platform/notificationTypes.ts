import type { NotificationTypeDeclaration } from "@xentium/plugin-sdk";
import { pluginRegistry } from "../plugin-engine/plugin-registry.js";

/**
 * The notification types add-ons send, so members can switch each one off in
 * Account → Notifications (in-app, and email where the add-on offers it). A choice
 * is stored as an exact-type row in the same preferences core's own types use, so
 * delivery needs no change: `notificationService.dispatch` already resolves it.
 *
 * A type may not start with one of core's prefixes: a plugin must not be able to
 * pose as, or switch off, core's own notifications.
 */

export interface RegisteredType { type: string; label: string; description: string | null; email: boolean; permission: string | null }

const TYPE = /^[a-z0-9][a-z0-9_-]*(\.[a-z0-9_-]+)+$/i;
const CORE_PREFIXES = ["social.", "profile.", "mention.", "article.", "progression.", "badge.", "system.", "license.", "mod.", "moderation."];

const registry = new Map<string, RegisteredType[]>();

/** A readable label from a type with none: "forum.thread_reply" → "Thread reply". */
function labelFrom(type: string): string {
  const words = type.split(".").slice(1).join(" ").replace(/[_-]+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : type;
}

export function registerNotificationTypes(pluginId: string, list: Array<string | NotificationTypeDeclaration>): void {
  const out: RegisteredType[] = [];
  for (const item of list) {
    const d = typeof item === "string" ? { type: item } : item;
    if (!TYPE.test(d.type)) throw new Error(`[notification types] ${pluginId}: "${d.type}" is not a notification type (like "${pluginId.replace(/^xentium-/, "")}.reply").`);
    if (CORE_PREFIXES.some((p) => d.type.startsWith(p))) throw new Error(`[notification types] ${pluginId}: "${d.type}" uses a prefix core keeps for itself.`);
    out.push({
      type: d.type, label: d.label ?? labelFrom(d.type), description: d.description ?? null,
      email: d.email !== false, permission: d.permission ?? null,
    });
  }
  registry.set(pluginId, out);
}

export function deregisterNotificationTypes(pluginId: string): void {
  registry.delete(pluginId);
}

/** Every registered type, grouped by add-on, for the preferences page. */
export function notificationTypeGroups(): Array<{ pluginId: string; name: string; types: RegisteredType[] }> {
  return [...registry.entries()]
    .filter(([, types]) => types.length)
    .map(([pluginId, types]) => ({ pluginId, name: pluginRegistry.get(pluginId)?.manifest.name ?? pluginId, types }));
}

export function registeredType(type: string): RegisteredType | null {
  for (const types of registry.values()) {
    const hit = types.find((t) => t.type === type);
    if (hit) return hit;
  }
  return null;
}

/** For tests. */
export function _resetNotificationTypes(): void {
  registry.clear();
}

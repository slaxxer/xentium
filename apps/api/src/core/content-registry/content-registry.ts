/**
 * "May this viewer see that piece of content?" — asked by plugins that show
 * something INSIDE someone else's content (a poll inside a forum post or an
 * article), and answered by whoever owns the content: core for `article`, the
 * forum for `forum.post`.
 *
 * ⚠ FAILS CLOSED. An unknown kind, a disabled owner or a handler that throws is a
 * NO. The asker must treat no as "does not exist" (404), so nothing leaks from a
 * private board or a members-only article through an embed.
 *
 * Core's own kinds are registered under the owner `core` and never deregistered;
 * a plugin's go when it is disabled.
 */
import type { ContentKindHandler } from "@xentium/plugin-sdk";
import { logger } from "../../infrastructure/logging/logger.js";

interface Entry { owner: string; handler: ContentKindHandler }

/** Namespaced (`forum.post`) or one of core's bare words. */
const KIND_RE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;

class ContentRegistry {
  private entries = new Map<string, Entry>();

  register(owner: string, handler: ContentKindHandler): void {
    if (!KIND_RE.test(handler.kind)) throw new Error(`Invalid content kind "${handler.kind}"`);
    const held = this.entries.get(handler.kind);
    if (held && held.owner !== owner) {
      throw new Error(`Content kind "${handler.kind}" is already registered by ${held.owner}`);
    }
    this.entries.set(handler.kind, { owner, handler });
  }

  deregister(owner: string): void {
    for (const [kind, e] of this.entries) if (e.owner === owner) this.entries.delete(kind);
  }

  async canView(kind: string, id: string, viewerId: string | null): Promise<boolean> {
    const entry = this.entries.get(kind);
    if (!entry || !id) return false;
    try {
      return (await entry.handler.canView(id, viewerId)) === true;
    } catch (err) {
      logger.warn({ err, kind, owner: entry.owner }, "content canView failed — treated as not visible");
      return false;
    }
  }
}

export const contentRegistry = new ContentRegistry();

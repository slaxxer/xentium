/**
 * Plugin embeds (contracts/embeds.ts): plugin items shown inside written content.
 *
 * The content stores only placeholders. When a piece of content is SAVED, core
 * reads its placeholders and hands every registered embed type the ids of its own
 * kind that the content now holds — an empty list included, so a placeholder the
 * writer deleted is released too. When the content is DELETED for good, every type
 * is told to drop what it held there.
 *
 * ⚠ Never fails the save. The content is the member's work; an embed that could
 * not be attached is logged and simply not shown (its owner fails closed).
 */
import { extractEmbeds } from "@xentium/contracts";
import type { EmbedHandler, EmbedHost } from "@xentium/plugin-sdk";
import { logger } from "../../infrastructure/logging/logger.js";

interface Entry { pluginId: string; handler: EmbedHandler }

class EmbedRegistry {
  private entries = new Map<string, Entry>();

  register(pluginId: string, handler: EmbedHandler): void {
    const held = this.entries.get(handler.type);
    if (held && held.pluginId !== pluginId) {
      throw new Error(`Embed type "${handler.type}" is already registered by ${held.pluginId}`);
    }
    this.entries.set(handler.type, { pluginId, handler });
  }

  deregister(pluginId: string): void {
    for (const [type, e] of this.entries) if (e.pluginId === pluginId) this.entries.delete(type);
  }

  /** `content` is the saved body: HTML, or a ProseMirror document (articles). */
  async sync(host: EmbedHost, content: unknown): Promise<void> {
    if (this.entries.size === 0) return;
    const refs = extractEmbeds(content);
    for (const [type, { pluginId, handler }] of this.entries) {
      const ids = refs.filter((r) => r.type === type).map((r) => r.id);
      try {
        await handler.sync(host, ids);
      } catch (err) {
        logger.warn({ err, pluginId, type, kind: host.kind, id: host.id }, "embed sync failed");
      }
    }
  }

  async remove(host: Omit<EmbedHost, "authorId">): Promise<void> {
    for (const [type, { pluginId, handler }] of this.entries) {
      try {
        await handler.remove(host);
      } catch (err) {
        logger.warn({ err, pluginId, type, kind: host.kind, id: host.id }, "embed remove failed");
      }
    }
  }
}

export const embedRegistry = new EmbedRegistry();

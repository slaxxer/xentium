/**
 * Block panels: settings an add-on puts on the blocks they belong to.
 *
 * An add-on names the block types its panel is for, and Theme Studio shows the panel
 * in that block's settings only. That keeps an effect where it makes sense: an avatar
 * effect on the avatar block, not on every block that happens to have edge art.
 *
 * A panel stages SITE-WIDE values in the theme's style draft (`setThemeTokens`), the
 * same draft the theme's colours live in. So what it sets is per theme, shows in the
 * editor's preview at once, goes live with Publish, and reaches every page through the
 * served stylesheet, not only the page the block is on.
 *
 * Exposed to plugins as `window.__XENTIUM_HOST__.webBlockPanels` (core 1.0.0-alpha.20+).
 * A plugin must externalize `@web/layout/blockPanelRegistry`: a bundled copy registers
 * into a Map nothing reads.
 */
import type { ComponentType } from "react";

export interface BlockPanelProps {
  /** The selected block. */
  block: { id: string; type: string; props: Record<string, unknown> };
  /** The template being edited (`profile`, `chrome.header`…). */
  templateKey: string;
  /** The theme's site-wide tokens as the draft has them: what it ships, then the admin's. */
  themeTokens: Record<string, string>;
  /**
   * Stage site-wide tokens in the theme's draft. `null` clears one (back to what the
   * theme ships). Names must be CSS custom properties; use your own prefix.
   */
  setThemeTokens: (tokens: Record<string, string | null>) => void;
}

export interface BlockPanel {
  /** Unique: `<namespace>.<name>`. */
  id: string;
  pluginId: string;
  /** The block types it shows on. */
  blockTypes: readonly string[];
  /** The fold's title, in the admin's language. */
  title: () => string;
  /** Marks the fold as in use (the dot beside the title), from the theme's tokens. */
  active?: (themeTokens: Record<string, string>) => boolean;
  Panel: ComponentType<BlockPanelProps>;
}

const panels = new Map<string, BlockPanel>();

/** Register a panel. THROWS on a taken id, like the edge registry. */
export function registerBlockPanel(panel: BlockPanel): void {
  if (!/^[a-z0-9-]+\.[\w-]+$/i.test(panel.id)) throw new Error(`Block panel "${panel.id}" must be "<namespace>.<name>".`);
  const taken = panels.get(panel.id);
  if (taken && taken.pluginId !== panel.pluginId) throw new Error(`Block panel "${panel.id}" is already registered.`);
  panels.set(panel.id, panel);
}

/** Remove a plugin's panels. What they staged stays in the theme. */
export function deregisterBlockPanelsFor(pluginId: string): void {
  for (const [id, p] of panels) if (p.pluginId === pluginId) panels.delete(id);
}

/** The panels for one block type, in registration order. */
export const blockPanelsFor = (type: string): BlockPanel[] =>
  [...panels.values()].filter((p) => p.blockTypes.includes(type));

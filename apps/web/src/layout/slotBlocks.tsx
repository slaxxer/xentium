/**
 * Plugin slot contributions, as individually placeable blocks (ADR-0005).
 *
 * Plugins have always extended the UI through `slotRegistry` — a header widget, a
 * layout widget, a profile tab — and those rendered at fixed outlets: a widget went
 * wherever `<LayoutWidgetOutlet>` happened to be mounted, and every header widget
 * appeared in one cluster next to the bell. An admin could not move any of it.
 *
 * This bridges the two registries: **each contribution becomes its own block**, so
 * the layout editor treats a plugin's bell exactly like the site logo. Nothing about
 * a plugin changes — no re-release, no new API to adopt — because the block is
 * derived from what the plugin already registered.
 *
 * A plugin that wants a first-class block still registers one directly via
 * `blockRegistry` (see `docs/plugin-blocks.md`); that remains the better path for new
 * work, because it gets typed props and a generated settings form. This is the bridge
 * for everything that already exists.
 *
 * ## Three things worth knowing
 *
 * **Ownership is preserved.** Each derived block carries the contributing plugin's
 * `pluginId`, so disabling the plugin removes the block — and the admin's document
 * keeps the node, because an unknown type is skipped and kept, not deleted. Re-enable
 * and it reappears exactly where they put it.
 *
 * **Layout widgets keep their outlet self-gating.** `LayoutWidgetSlot` components
 * decide for themselves whether to render at a given outlet — placement was "the
 * plugin's own configuration". Breaking that would blank out every existing widget,
 * so the derived block passes an outlet the ADMIN chooses instead. The widget's own
 * check still runs; what changes is that the admin now decides where on the page the
 * outlet effectively is. A widget that ignores `outlet` renders anywhere.
 *
 * **Re-registration is safe.** `registerBlock` keys by type, so calling this after
 * each plugin bundle loads simply overwrites — which is what the bootstrap does.
 */
import { z } from "zod";
import { slotRegistry } from "../plugins/slotRegistry";
import { registerBlock } from "./blockRegistry";
import { MemberWidget } from "../components/MembersOnly";

/** Prefix for every derived type, so they are recognisable and never collide. */
export const SLOT_BLOCK_PREFIX = "slot.";

export const isSlotBlockType = (type: string): boolean => type.startsWith(SLOT_BLOCK_PREFIX);

/** The block type derived for one contribution. */
export const slotBlockType = (kind: string, id: string): string =>
  `${SLOT_BLOCK_PREFIX}${kind}.${id}`;

/**
 * Core outlets a layout widget may be asked to render as.
 *
 * Offered as a choice because the widget still self-gates on it. The list is the set
 * of outlet ids core has ever mounted, so an existing widget's own check keeps
 * matching.
 */
const OUTLETS = ["aside", "top", "home-top", "forum-top"] as const;

const layoutWidgetSchema = z.object({
  outlet: z.enum(OUTLETS).default("aside").meta({
    title: "Render as outlet",
    description: "Plugin widgets choose which outlet they appear in. Pick the one this widget expects.",
  }),
});

/**
 * Turn every current slot contribution into a block.
 *
 * Called from the bootstrap once plugin bundles have loaded. Safe to call again.
 */
export function registerSlotBlocks(): void {
  // ── Header widgets → chrome.header ────────────────────────────────────────
  for (const widget of slotRegistry.getHeaderWidgets()) {
    const Widget = widget.component;
    registerBlock({
      type:     slotBlockType("headerWidget", widget.id),
      pluginId: slotRegistry.ownerOf(widget.id),
      schema:   z.object({}),
      editorMeta: {
        label: widget.id,
        category: "plugin",
        // A header widget is chrome; it has no page context to read.
        allowedTemplates: ["chrome.header"],
      },
      // Members only, wherever the admin placed it (see MemberWidget).
      component: () => <MemberWidget><Widget /></MemberWidget>,
    });
  }

  // ── Layout widgets → any page template ───────────────────────────────────
  for (const widget of slotRegistry.getLayoutWidgets()) {
    const Widget = widget.component;
    registerBlock({
      type:     slotBlockType("layoutWidget", widget.id),
      pluginId: slotRegistry.ownerOf(widget.id),
      schema:   layoutWidgetSchema,
      editorMeta: { label: widget.id, category: "plugin" },
      component: ({ props }) => <Widget outlet={(props as { outlet: string }).outlet} />,
    });
  }

  // ── Profile tabs → the profile template ──────────────────────────────────
  // Placeable on their own, so a plugin's profile tab can become a permanent panel
  // on the card rather than something behind a tab.
  for (const tab of slotRegistry.getProfileTabs()) {
    const Tab = tab.component;
    registerBlock({
      type:     slotBlockType("profileTab", tab.id),
      pluginId: slotRegistry.ownerOf(tab.id),
      schema:   z.object({}),
      editorMeta: { label: tab.label, category: "plugin", allowedTemplates: ["profile"] },
      // The profile host resolves the profile; this reads it the same way core
      // profile blocks do, so the plugin component gets what it always got.
      component: ({ context }) => {
        const ctx = context as { profile?: { id: string; username: string; isOwn: boolean } };
        if (!ctx.profile) return null;
        return (
          <Tab profileId={ctx.profile.id}
            profileUsername={ctx.profile.username} isOwn={ctx.profile.isOwn} />
        );
      },
    });
  }
}

/**
 * Which slot ids a document already places as their own block.
 *
 * The aggregate `headerWidgets` block renders the whole cluster, which is what an
 * untouched layout wants — but once an admin has positioned a widget individually,
 * rendering it in the cluster too would show it twice. So the aggregate consults this
 * and skips what the document already places.
 */
export function individuallyPlacedSlotIds(types: Iterable<string>, kind: string): Set<string> {
  const prefix = `${SLOT_BLOCK_PREFIX}${kind}.`;
  const out = new Set<string>();
  for (const type of types) {
    if (type.startsWith(prefix)) out.add(type.slice(prefix.length));
  }
  return out;
}

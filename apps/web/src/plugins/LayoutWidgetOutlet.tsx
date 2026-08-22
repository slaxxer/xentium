import { slotRegistry } from "./slotRegistry";

/**
 * Generic mount point for plugin layout widgets (slotRegistry.registerLayoutWidget).
 *
 * Placed by the layout and by rail-owning pages:
 *   - AppLayout renders <LayoutWidgetOutlet outlet="top" /> inside .app-main,
 *     directly above the routed page — widgets there are clamped to the same
 *     --content-max column as the page content (never full-bleed).
 *   - Pages that own a rail render <LayoutWidgetOutlet outlet="aside" /> inside it.
 *   - The forum index renders <LayoutWidgetOutlet outlet="forum-top" /> between
 *     its stats row and the category list.
 *
 * The outlet is intentionally dumb: it renders every registered widget and passes
 * the outlet id. Each widget decides itself whether it belongs in that outlet on
 * the current route (placement is plugin-side configuration), returning null
 * otherwise — so an unused outlet costs nothing visually.
 */
export function LayoutWidgetOutlet({
  outlet,
  skipIds,
}: {
  outlet: string;
  /**
   * Widget ids to leave out.
   *
   * Every layout widget is ALSO its own layout block now
   * (`layout/slotBlocks.tsx`), which is how an admin positions one individually.
   * Drawing it here as well would render it twice, so the `pluginSlot` block passes
   * whatever the document already places — making the two mechanisms alternatives
   * rather than a duplication hazard.
   */
  skipIds?: ReadonlySet<string>;
}) {
  const widgets = slotRegistry.getLayoutWidgets()
    .filter((w) => !skipIds?.has(w.id));
  if (widgets.length === 0) return null;
  return (
    <>
      {widgets.map((w) => {
        const Widget = w.component;
        return <Widget key={w.id} outlet={outlet} />;
      })}
    </>
  );
}

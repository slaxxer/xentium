import { Suspense } from "react";
import { Outlet } from "react-router-dom";
import { PubNav } from "./PubNav";
import { SiteBars } from "./SiteBars";
import { SiteFooter } from "./SiteFooter";
import { ModCanvas } from "../features/modcp/ModCanvas";
import { LevelUpDialog } from "../features/progression/LevelUpDialog";
import { LayoutWidgetOutlet } from "../plugins/LayoutWidgetOutlet";
import { RouteErrorBoundary } from "../features/errors/ErrorBoundary";
import { presentFrame, usePageTemplate, useSiteFrame } from "../layout/siteFrame";
import "./AppLayout.scss";
import { UserHoverCardHost } from "../components/UserHoverCard";
import { slotRegistry } from "../plugins/slotRegistry";
import { isEditorPreview } from "../layout/previewMode";

export function AppLayout() {
  const frame = presentFrame(useSiteFrame(), usePageTemplate());

  /*
   * The frame wrappers are UNCONDITIONAL. Which of them draws a box depends on the
   * mode (see AppLayout.scss); in `full` all three are `display: contents` and the
   * page lays out exactly as it did before frames existed. A DOM shape that changed
   * with the mode would break every custom stylesheet written against the other one.
   *
   *   .app-frame        the box, in boxed and flush
   *   .app-frame__body  everything under the header: carries the overlap band
   *   .app-frame__box   the box around page + footer, in framed and overlap
   *   .app-frame__foot  the footer's own card, in floating
   */
  return (
    <div className={frame.className} style={frame.style} data-frame={frame.mode}>
      <div className="app-frame">
        <PubNav />
        {/* Under the navbar and inside the frame, so it takes the frame's width:
            edge to edge in `full`, the box's width in boxed layouts. */}
        <SiteBars />
        <div className="app-frame__body">
          <div className="app-frame__box">
            <main className="app-main">
              <LayoutWidgetOutlet outlet="top" />
              {/* Page crashes stay contained: nav, footer and the widget outlets keep
                  working, and navigating away clears the error. */}
              <RouteErrorBoundary variant="inline">
                {/* Some pages (the article editor) load on demand. */}
                <Suspense fallback={null}><Outlet /></Suspense>
              </RouteErrorBoundary>
            </main>
            <div className="app-frame__foot">
              <SiteFooter />
            </div>
          </div>
        </div>
      </div>
      <ModCanvas />
      <LevelUpDialog />
      {/* Hover a username or avatar anywhere on the site: the profile miniature.
          Inside the router (its links need it), outside the ACP. */}
      <UserHoverCardHost />
      {/* Plugins' site-wide overlays (a consent dialog). Not in the layout editor's
          preview: the page is being arranged there, not visited. */}
      {!isEditorPreview() && slotRegistry.getSiteOverlays().map((o) => <o.component key={o.id} />)}
    </div>
  );
}

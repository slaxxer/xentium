import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Outlet } from "react-router-dom";
import { api } from "../lib/api";
import { PubNav } from "./PubNav";
import { SiteFooter } from "./SiteFooter";
import { ModCanvas } from "../features/modcp/ModCanvas";
import { LevelUpDialog } from "../features/progression/LevelUpDialog";
import { LayoutWidgetOutlet } from "../plugins/LayoutWidgetOutlet";
import { RouteErrorBoundary } from "../features/errors/ErrorBoundary";
import { presentFrame, usePageTemplate, useSiteFrame } from "../layout/siteFrame";
import "./AppLayout.scss";

/** Keeps the <link rel="icon"> in sync with the uploaded favicon. */
function useFavicon() {
  const { data } = useQuery<{ iconUrl: string | null }>({
    queryKey: ["pub-branding"],
    queryFn:  () => api.get("/appearance/branding"),
    staleTime: 300_000,
  });
  useEffect(() => {
    if (!data?.iconUrl) return;
    let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = data.iconUrl;
  }, [data?.iconUrl]);
}

export function AppLayout() {
  useFavicon();
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
        <div className="app-frame__body">
          <div className="app-frame__box">
            <main className="app-main">
              <LayoutWidgetOutlet outlet="top" />
              {/* Page crashes stay contained: nav, footer and the widget outlets keep
                  working, and navigating away clears the error. */}
              <RouteErrorBoundary variant="inline">
                <Outlet />
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
    </div>
  );
}

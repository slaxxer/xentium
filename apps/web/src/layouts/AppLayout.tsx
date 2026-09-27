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

  return (
    <div className="app-layout">
      <PubNav />
      <main className="app-main">
        <LayoutWidgetOutlet outlet="top" />
        {/* Page crashes stay contained: nav, footer and the widget outlets keep
            working, and navigating away clears the error. */}
        <RouteErrorBoundary variant="inline">
          <Outlet />
        </RouteErrorBoundary>
      </main>
      <SiteFooter />
      <ModCanvas />
      <LevelUpDialog />
    </div>
  );
}

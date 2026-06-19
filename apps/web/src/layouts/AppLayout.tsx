import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Outlet } from "react-router-dom";
import { api } from "../lib/api";
import { PubNav } from "./PubNav";
import { SiteFooter } from "./SiteFooter";
import { ModCanvas } from "../features/modcp/ModCanvas";
import { applyTokenCss, startStyleSync } from "../lib/liveStyle";
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

/** Injects the active appearance token overrides and keeps them live-synced. */
function useCustomTokens() {
  useEffect(() => {
    fetch("/api/appearance/css")
      .then((r) => (r.ok ? r.text() : ""))
      .then((css) => { if (css) applyTokenCss(css); })
      .catch(() => {});
    startStyleSync();
  }, []);
}

export function AppLayout() {
  useCustomTokens();
  useFavicon();

  return (
    <div className="app-layout">
      <PubNav />
      <main className="app-main">
        <Outlet />
      </main>
      <SiteFooter />
      <ModCanvas />
    </div>
  );
}

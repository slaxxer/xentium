import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Outlet } from "react-router-dom";
import { PubNav } from "./PubNav";
import { OnlineCounter } from "../components/OnlineCounter";
import { ModCanvas } from "../features/modcp/ModCanvas";
import "./AppLayout.scss";

const STYLE_ID = "nodevo-custom-tokens";

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

/** Injects the active appearance token overrides as a <style> tag. */
function useCustomTokens() {
  useEffect(() => {
    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = STYLE_ID;
      document.head.appendChild(el);
    }
    fetch("/api/appearance/css")
      .then((r) => (r.ok ? r.text() : ""))
      .then((css) => { if (el) el.textContent = css; })
      .catch(() => {});
    return () => { /* keep the style tag — it's global */ };
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
      <footer className="app-footer">
        <span>Nodevo v1</span>
        <OnlineCounter />
      </footer>
      <ModCanvas />
    </div>
  );
}

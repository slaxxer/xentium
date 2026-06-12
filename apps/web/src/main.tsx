import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./lib/i18n";
import "./hooks/useFont"; // applies stored font to --ff-sans before first render
import App from "./app/App";
import "./plugins/host-globals"; // sets window.__NODEVO_HOST__ before any plugin bundle loads
import "./styles/index.scss";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "@fontsource/raleway/400.css";
import "@fontsource/raleway/500.css";
import "@fontsource/raleway/600.css";
import "@fontsource/raleway/700.css";
import "@fontsource/montserrat/400.css";
import "@fontsource/montserrat/500.css";
import "@fontsource/montserrat/600.css";
import "@fontsource/montserrat/700.css";
import "@fontsource/ubuntu/400.css";
import "@fontsource/ubuntu/500.css";
import "@fontsource/ubuntu/700.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import "@fontsource/poppins/800.css";
import "@fontsource/nunito/400.css";
import "@fontsource/nunito/500.css";
import "@fontsource/nunito/600.css";
import "@fontsource/nunito/700.css";
import "@fontsource/nunito/800.css";
import "@fontsource/open-sans/400.css";
import "@fontsource/open-sans/500.css";
import "@fontsource/open-sans/600.css";
import "@fontsource/open-sans/700.css";
import { config } from "@fortawesome/fontawesome-svg-core";
import "@fortawesome/fontawesome-svg-core/styles.css";
config.autoAddCss = false;

// ── Runtime loader: fetch + execute an enabled plugin's compiled UMD bundle ───
// Used in production. The bundle reads shared deps from window.__NODEVO_HOST__
// and registers into slotRegistry as a side effect.
function loadPluginBundle(id: string): Promise<void> {
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = `/api/meta/plugin-web/${id}`;
    s.async = false; // preserve registration order
    s.onload = () => resolve();
    s.onerror = () => { console.error(`Failed to load plugin web bundle: ${id}`); resolve(); };
    document.head.appendChild(s);
  });
}

// ── Bootstrap: check enabled plugins, then render ─────────────────────────────
async function bootstrap() {
  // Site default language for visitors with no explicit choice (§60.3) —
  // makes the admin's chosen language take effect on every device, not just
  // the one that ran the installer (which has the wizard's nv_locale cookie).
  const { applySiteDefaultLocale } = await import("./lib/i18n");
  await applySiteDefaultLocale();

  // Fetch enabled plugin IDs from the public meta endpoint.
  // Falls back to empty array (all plugins disabled) on error.
  let enabledIds: string[] = [];
  let pluginLoadFailed = false;
  try {
    const res = await fetch("/api/meta/enabled-plugins", { credentials: "include" });
    if (res.ok) enabledIds = await res.json();
  } catch {
    // API unreachable (e.g. installer hasn't run yet, or transient outage) — no plugins active.
    // Set a flag so the app can warn the user if needed.
    pluginLoadFailed = true;
  }

  // Store the flag so App-level banners can warn the user to reload.
  if (pluginLoadFailed) {
    sessionStorage.setItem("pluginLoadFailed", "1");
  }

  // Activate enabled plugins' web entries.
  // Dev: build-time imports (full HMR). Prod: runtime-load compiled bundles.
  if (import.meta.env.DEV) {
    const { loadDevPlugins, DEV_PLUGIN_IDS } = await import("./plugins/dev-plugins");
    await loadDevPlugins(enabledIds);
    // Any enabled plugin without a build-time HMR entry (e.g. an uploaded
    // .nvplugin) is runtime-loaded from its compiled bundle, exactly like prod.
    for (const id of enabledIds) {
      if (!DEV_PLUGIN_IDS.includes(id)) await loadPluginBundle(id);
    }
  } else {
    for (const id of enabledIds) {
      await loadPluginBundle(id);
    }
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

bootstrap();

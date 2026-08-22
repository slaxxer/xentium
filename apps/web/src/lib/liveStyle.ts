// Live theme sync — push transport (Server-Sent Events).
//
// The active appearance tokens are served as CSS from /api/appearance/css and
// injected into a single <style id="nodevo-custom-tokens"> tag. That endpoint is
// browser-cached (max-age=60) for load performance, so on its own a change in the
// Style Editor would take up to a minute to reach other open clients.
//
// To make changes propagate "systemwide" the moment they happen — without every
// client polling forever — each client opens ONE EventSource to
// /api/appearance/stream. The server pushes a `version` event only when the active
// theme actually changes (admin saved a style, activated a pack, restored a
// snapshot); the client then refetches the CSS (cache-busted) and re-injects it.
// Steady state is zero requests per client. EventSource auto-reconnects on drop,
// and the server resends the current version on connect, so a change missed while
// disconnected is reconciled on reconnect.

const STYLE_ID = "nodevo-custom-tokens";

/** Inject (or replace) the global token <style> tag. */
export function applyTokenCss(css: string): void {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = css;
}

/** Fetch the active CSS bypassing the browser HTTP cache, then apply it. */
export async function refreshTokenCss(): Promise<void> {
  try {
    const res = await fetch(`/api/appearance/css?t=${Date.now()}`, { cache: "no-store" });
    if (res.ok) applyTokenCss(await res.text());
  } catch {
    /* offline / transient — EventSource reconnect reconciles */
  }
}

let started = false;
let lastVersion: number | null = null;
let source: EventSource | null = null;

// Anything else that must refresh when the style version changes. Page layouts
// (ADR-0005) ride this channel rather than opening a second stream: a layout
// publish bumps the same version, so one event refreshes both tokens and
// structure. Listeners are called only on an actual change, never on the
// connect/reconnect echo.
const versionListeners = new Set<() => void>();

/** Subscribe to style-version changes. Returns an unsubscribe function. */
export function onStyleVersionChange(fn: () => void): () => void {
  versionListeners.add(fn);
  return () => versionListeners.delete(fn);
}

/**
 * Begin systemwide style sync over SSE. Idempotent — safe to call from multiple
 * mount points; only the first call opens the connection.
 */
export function startStyleSync(): void {
  if (started) return;
  started = true;
  if (typeof EventSource === "undefined") return; // unsupported (negligible in practice)

  source = new EventSource("/api/appearance/stream");
  source.addEventListener("version", (e) => {
    const version = Number((e as MessageEvent).data);
    if (!Number.isFinite(version)) return;
    // The first event (and each reconnect's first event) is the current version.
    // Startup already injected the current CSS, so only refetch when the version
    // differs from what we last saw — which also catches a change that happened
    // while we were disconnected.
    if (lastVersion !== null && version !== lastVersion) {
      void refreshTokenCss();
      for (const fn of versionListeners) {
        // One bad listener must not stop the others, or a thrown error here
        // would leave clients on stale CSS.
        try { fn(); } catch { /* ignore */ }
      }
    }
    lastVersion = version;
  });
  // On transient errors EventSource reconnects on its own using the server's
  // `retry:` hint; no manual handling needed. Closing only happens on page unload.
}

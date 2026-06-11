// Live theme sync.
//
// The active appearance tokens are served as CSS from /api/appearance/css and
// injected into a single <style id="nodevo-custom-tokens"> tag. That endpoint is
// browser-cached (max-age=60) for load performance, so on its own a change in the
// Style Editor would take up to a minute to reach other open clients.
//
// To make changes propagate "systemwide" within a few seconds, every client polls
// a tiny version endpoint (/api/appearance/version). When the version bumps — i.e.
// an admin saved a style, activated a pack, or restored a snapshot — each client
// refetches the CSS (cache-busted) and re-injects it. The server returns the poll
// cadence in the same response, so the interval is adjustable live from the ACP.

const STYLE_ID = "nodevo-custom-tokens";

const DEFAULT_INTERVAL_MS = 5000;
const MIN_INTERVAL_MS = 2000;
const MAX_INTERVAL_MS = 60000;

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
    /* offline / transient — next poll retries */
  }
}

const clamp = (ms: number) => Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, ms));

let started = false;
let lastVersion: number | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

async function poll(): Promise<void> {
  let nextMs = DEFAULT_INTERVAL_MS;
  try {
    const res = await fetch("/api/appearance/version", { cache: "no-store" });
    if (res.ok) {
      const { version, intervalMs } = (await res.json()) as { version: number; intervalMs?: number };
      if (typeof intervalMs === "number" && Number.isFinite(intervalMs)) nextMs = intervalMs;
      // First successful poll only records the baseline — the startup injection
      // already loaded the current CSS, so don't refetch needlessly.
      if (lastVersion !== null && version !== lastVersion) await refreshTokenCss();
      lastVersion = version;
    }
  } catch {
    /* transient — fall back to default cadence */
  }
  schedule(nextMs);
}

function schedule(ms: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(poll, clamp(ms));
}

/**
 * Begin the systemwide style-sync poll loop. Idempotent — safe to call from
 * multiple mount points; only the first call starts the loop.
 */
export function startStyleSync(): void {
  if (started) return;
  started = true;
  poll();
  // Re-check the moment the tab regains focus so a change made elsewhere applies
  // immediately instead of after up to one interval.
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        if (timer) clearTimeout(timer);
        poll();
      }
    });
  }
}

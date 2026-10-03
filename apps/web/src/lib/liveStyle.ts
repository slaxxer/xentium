// Live theme sync — push transport (Server-Sent Events).
//
// The active appearance tokens are served as CSS from /api/appearance/css and
// injected into a single <style id="xentium-custom-tokens"> tag. That endpoint
// revalidates rather than being held for a minute, so a page always PAINTS the
// current theme; on its own, though, a change made after the page loaded would
// never reach it.
//
// To make changes propagate "systemwide" the moment they happen — without every
// client polling forever — each client opens ONE EventSource to
// /api/appearance/stream. The server pushes a `version` event only when the active
// theme actually changes (admin saved a style, activated a pack, restored a
// snapshot); the client then refetches the CSS (cache-busted) and re-injects it.
// Steady state is zero requests per client. EventSource auto-reconnects on drop,
// and the server resends the current version on connect, so a change missed while
// disconnected is reconciled on reconnect.

import { viewerThemeParam } from "./viewerTheme";
import { previewThemeKey, withTheme } from "./editingTheme";

/** The draft stylesheet of the theme a preview is showing (`__theme=`, else the active one). */
const draftCssUrl = () => withTheme("/api/appearance/css?source=draft", previewThemeKey());

const STYLE_ID = "xentium-custom-tokens";

/**
 * The stylesheet the server inlined into index.html, if any, and its version.
 *
 * Adopting the version means a page that painted from the inlined sheet is already
 * "holding" something, so the stream can reconcile it before the startup fetch lands.
 */
function adoptInlinedVersion(): void {
  if (typeof document === "undefined") return;
  const v = Number(document.getElementById(STYLE_ID)?.dataset.styleVersion);
  if (Number.isFinite(v) && v > 0 && loadedVersion === null) loadedVersion = v;
}

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

/** Refetch the stylesheet this client is showing, bypassing the browser cache.
 *  The SAME half it loaded — refreshing a preview with the LIVE stylesheet would
 *  quietly end the preview. */
export async function refreshTokenCss(): Promise<void> {
  /**
   * ⚠ The SAME half that was loaded — draft, a visitor's theme, or the site's own.
   * A refresh that dropped the qualifier would answer with the live site sheet, and
   * the reader would be snapped out of the theme they chose by a mechanism whose
   * only job is to fix staleness.
   */
  const themed = loadedDraft ? "" : viewerThemeParam();
  if (loadedDraft) {
    await fetchTokenCss(`${draftCssUrl()}&t=${Date.now()}`, { cache: "no-store" });
    return;
  }
  const qualifier = themed ? `${themed}&` : "";
  await fetchTokenCss(`/api/appearance/css?${qualifier}t=${Date.now()}`, { cache: "no-store" });
}

/**
 * The STARTUP load: inject the current stylesheet and remember which version it is.
 *
 * Every mount point that paints tokens goes through here rather than fetching the
 * endpoint itself — three copies of the same `fetch` is how one of them would keep
 * dropping the version stamp that the reconcile below depends on.
 *
 * `draft` is the layout preview's stylesheet (the theme layer plus the admin's own
 * staged edits); it carries no version of its own and is never reconciled, because
 * the draft is not what the stream announces.
 */
export async function loadTokenCss(opts: { draft?: boolean } = {}): Promise<void> {
  loadedDraft = !!opts.draft;
  if (!loadedDraft) adoptInlinedVersion();
  if (loadedDraft) {
    await fetchTokenCss(draftCssUrl());
    return;
  }
  /**
   * A visitor wearing one of the installed themes gets THAT stylesheet.
   *
   * ⚠ The response carries no `X-Style-Version`, so `loadedVersion` stays null and
   * `reconcile()` treats it the way it treats a draft: the stream can announce what
   * it likes and this client will not pull itself back to the site's own theme. That
   * is the point — the reader's choice must survive the admin publishing.
   */
  const themed = viewerThemeParam();
  await fetchTokenCss(themed ? `/api/appearance/css?${themed}` : "/api/appearance/css");
}

async function fetchTokenCss(url: string, init?: RequestInit): Promise<void> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) return;
    const css = await res.text();
    if (!css) return;
    applyTokenCss(css);
    // Absent on a draft response and on any older API — `null` then means "unknown",
    // which the reconcile treats as a reason to fall back, never as a match.
    const stamped = Number(res.headers.get("X-Style-Version"));
    loadedVersion = Number.isFinite(stamped) && stamped > 0 ? stamped : null;
    reconcile();
  } catch {
    /* offline / transient — EventSource reconnect reconciles */
  }
}

let started = false;
/** Whether this client is showing the DRAFT stylesheet (a layout/theme preview). */
let loadedDraft = false;
/** The version of the CSS currently injected, when the response said so. */
let loadedVersion: number | null = null;
/** The latest version the server has announced on the stream. */
let streamVersion: number | null = null;
/** The announced version a refetch has already been fired for. */
let attemptedFor: number | null = null;
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

function notifyVersionListeners(): void {
  for (const fn of versionListeners) {
    // One bad listener must not stop the others, or a thrown error here would
    // leave clients on stale CSS.
    try { fn(); } catch { /* ignore */ }
  }
}

/**
 * Refetch when what we are HOLDING is not what the server is announcing.
 *
 * ⚠ This compares the injected stylesheet's own version against the stream's, NOT
 * one stream event against the previous one. Comparing events is what made a theme
 * switch invisible: the page loaded a cached stylesheet, the stream's first event
 * carried the NEW version, the client recorded it as its baseline and, seeing no
 * further change, kept painting the old theme for as long as the tab stayed open.
 *
 * Runs on both inputs — a stream event and a startup load — because either can
 * arrive second.
 */
function reconcile(): void {
  if (streamVersion === null || loadedVersion === null) return;
  if (streamVersion === loadedVersion) return;
  /**
   * ⚠ ONE refetch per announced version. The refetch stamps `loadedVersion` with
   * whatever actually came back, so a response that is STILL stale — an
   * intermediary that ignored `no-store`, a version bumped again mid-flight —
   * would land right back here and fetch forever. The next announcement is what
   * tries again.
   */
  if (attemptedFor === streamVersion) return;
  attemptedFor = streamVersion;
  void refreshTokenCss();
  notifyVersionListeners();
}

/**
 * Begin systemwide style sync over SSE. Idempotent — safe to call from multiple
 * mount points; only the first call opens the connection.
 */
export function startStyleSync(): void {
  if (started) return;
  started = true;
  if (typeof EventSource === "undefined") return; // unsupported (negligible in practice)

  openStream();
  /**
   * ⚠ Closed EXPLICITLY when the document goes away, and reopened if it comes back.
   *
   * "The browser closes it on unload" was the assumption, and it is not reliable: a
   * bfcache'd page is frozen rather than unloaded, and a proxy in front of the API
   * may hold the upstream socket open long after the client is gone. Each one that
   * lingers costs a connection from the browser's per-origin budget, and at six the
   * ORIGIN stops answering that page entirely.
   *
   * `pagehide`, not `unload`: `unload` is not fired reliably and disqualifies the
   * page from bfcache outright.
   */
  window.addEventListener("pagehide", () => {
    source?.close();
    source = null;
  });
  // Restored from bfcache with a closed stream — reopen, and let `reconcile` catch
  // up on anything published while the page was frozen.
  window.addEventListener("pageshow", (e) => {
    if ((e as PageTransitionEvent).persisted && !source) openStream();
  });
}

function openStream(): void {
  source = new EventSource("/api/appearance/stream");
  source.addEventListener("version", (e) => {
    const version = Number((e as MessageEvent).data);
    if (!Number.isFinite(version)) return;
    const previous = streamVersion;
    streamVersion = version;

    if (loadedVersion !== null) { reconcile(); return; }

    /**
     * No version stamp on the stylesheet we hold. Three ways that happens, and one
     * of them must NOT refetch:
     *  - a draft preview, and an older API — the original rule applies: the first
     *    event of a connection is the current version, so only a CHANGE is
     *    actionable;
     *  - ⚠ a VISITOR WEARING A THEME, which is not the live sheet and never becomes
     *    stale against it. Refetching there would spend a request to replace the
     *    themed stylesheet with an identical one on every publish the admin makes.
     */
    if (viewerThemeParam()) {
      // A real change only: the connect echo notifying refetched the layouts the page
      // was just served with, on every load.
      if (previous !== null && previous !== version) notifyVersionListeners();
      return;
    }

    if (previous !== null && previous !== version) {
      void refreshTokenCss();
      notifyVersionListeners();
    }
  });
  // On transient errors EventSource reconnects on its own using the server's
  // `retry:` hint; no manual handling needed. Closing is `pagehide`'s job, above.
}

import { useEffect, useState, useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";
import { type NavItem, activeNavSection, navItemId } from "../useAcpNav";
import { AcpRail } from "./AcpRail";
import { AcpPanel } from "./AcpPanel";
import { useAcpCollapsed, PANEL_DOCK_MIN_WIDTH } from "./acpChrome";

/**
 * The rail chrome: icon rail and section panel.
 *
 * Three states, and the third is a viewport fact rather than a preference:
 *   docked    — rail + panel side by side.
 *   collapsed — rail only; a section opens as a flyout over the content.
 *   narrow    — below PANEL_DOCK_MIN_WIDTH the panel cannot dock at all, so the
 *               admin's preference is overridden rather than lost. It comes
 *               back untouched when the window is wide enough again.
 *
 * Theme Studio collapses it too, the same way (preference kept): it is three panes
 * around a live page, and the section panel's 248px is the page's to use.
 */

/** Pages that are a workspace, not a settings page: they want the whole width. */
const WORKSPACES = ["/admin/theme-studio"];

function subscribeWidth(fn: () => void) {
  const mq = window.matchMedia(`(max-width: ${PANEL_DOCK_MIN_WIDTH - 1}px)`);
  mq.addEventListener("change", fn);
  return () => mq.removeEventListener("change", fn);
}
function isNarrow() {
  return typeof window !== "undefined"
    && window.matchMedia(`(max-width: ${PANEL_DOCK_MIN_WIDTH - 1}px)`).matches;
}

export function AcpRailShell({ nav, children }: { nav: NavItem[]; children: React.ReactNode }) {
  const prefersCollapsed = useAcpCollapsed();
  const narrow = useSyncExternalStore(subscribeWidth, isNarrow, () => false);
  const { pathname } = useLocation();
  const workspace = WORKSPACES.some((p) => pathname.startsWith(p));
  const collapsed = prefersCollapsed || narrow || workspace;

  const [flyout, setFlyout] = useState<string | null>(null);

  const section = activeNavSection(nav, pathname);
  const activeId = section ? navItemId(section) : null;
  const flySection = flyout ? nav.find((n) => navItemId(n) === flyout) : undefined;

  // The flyout is a preview of somewhere you are not. Arriving anywhere ends it,
  // and so does docking the panel — otherwise it would sit on top of itself.
  useEffect(() => { setFlyout(null); }, [pathname]);
  useEffect(() => { if (!collapsed) setFlyout(null); }, [collapsed]);

  useEffect(() => {
    if (!flyout) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFlyout(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [flyout]);

  return (
    <div className={`acp-shell${collapsed ? " is-collapsed" : ""}`}>
      <AcpRail
        nav={nav}
        activeId={activeId}
        flyoutId={flyout}
        collapsed={collapsed}
        canDock={!narrow}
        onPeek={setFlyout}
      />

      {!collapsed && <AcpPanel section={section} />}

      {flySection && (
        <>
          <div className="acp-scrim" onClick={() => setFlyout(null)} aria-hidden />
          <AcpPanel
            section={flySection}
            variant="flyout"
            canDock={!narrow}
            showSearch={false}
            onNavigate={() => setFlyout(null)}
          />
        </>
      )}

      <div className="acp-main">
        {children}
      </div>
    </div>
  );
}

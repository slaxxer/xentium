import { useCallback, useEffect, useState, type RefObject } from "react";

// Per-admin ACP chrome preferences, persisted to localStorage (a browser-local
// UI preference — no server round-trip). The redesign's "Tweaks" panel writes
// these; AcpLayout reads them to pick the nav chrome and apply density/accent.

export type AcpNavLayout = "horizontal" | "sidebar" | "rail";
export type AcpDensity = "comfortable" | "compact";

export interface AcpTweaks {
  navLayout: AcpNavLayout;
  density: AcpDensity;
  accent: string; // hex; "" = use the theme default
}

export const ACP_ACCENTS = ["#6d56e6", "#ff7a59", "#1fab74", "#2a6fdb"] as const;

export const ACP_TWEAK_DEFAULTS: AcpTweaks = {
  navLayout: "horizontal",
  density: "comfortable",
  accent: "",
};

const STORAGE_KEY = "nodevo.acp.tweaks";

function load(): AcpTweaks {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return ACP_TWEAK_DEFAULTS;
    return { ...ACP_TWEAK_DEFAULTS, ...(JSON.parse(raw) as Partial<AcpTweaks>) };
  } catch {
    return ACP_TWEAK_DEFAULTS;
  }
}

export function useAcpTweaks(): [AcpTweaks, <K extends keyof AcpTweaks>(key: K, value: AcpTweaks[K]) => void] {
  const [tweaks, setTweaks] = useState<AcpTweaks>(load);

  const setTweak = useCallback(<K extends keyof AcpTweaks>(key: K, value: AcpTweaks[K]) => {
    setTweaks((prev) => {
      const next = { ...prev, [key]: value };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* quota / private mode — ignore */ }
      return next;
    });
  }, []);

  return [tweaks, setTweak];
}

/** Applies density + accent to the ACP layout root as a data attr + scoped CSS
 *  variable override. Reads ref.current inside the effect (set post-mount), so it
 *  lands on first paint. Scoped to the ACP so it never leaks to the site. */
export function useApplyTweaks<T extends HTMLElement>(ref: RefObject<T | null>, tweaks: AcpTweaks): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.setAttribute("data-density", tweaks.density);
    if (tweaks.accent) {
      el.style.setProperty("--c-accent", tweaks.accent);
      el.style.setProperty("--c-accent-soft", `color-mix(in srgb, ${tweaks.accent} 14%, transparent)`);
    } else {
      el.style.removeProperty("--c-accent");
      el.style.removeProperty("--c-accent-soft");
    }
  }, [ref, tweaks.density, tweaks.accent]);
}

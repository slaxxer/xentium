import { useSyncExternalStore } from "react";

export const FONTS = [
  { value: "Figtree",    label: "Figtree",    desc: "Warm and clear (site base)",         stack: '"Figtree", system-ui, sans-serif' },
  { value: "Poppins",    label: "Poppins",    desc: "Geometric and friendly",             stack: "Poppins, sans-serif"     },
  { value: "Nunito",     label: "Nunito",     desc: "Warm & friendly",                    stack: "Nunito, sans-serif"      },
  { value: "Montserrat", label: "Montserrat", desc: "Geometric & versatile",              stack: "Montserrat, sans-serif"  },
  { value: "Open Sans",  label: "Open Sans",  desc: "Clean, neutral & readable",          stack: '"Open Sans", sans-serif' },
  { value: "Ubuntu",     label: "Ubuntu",     desc: "Humanist and approachable",          stack: "Ubuntu, sans-serif"      },
] as const;

export type FontValue = typeof FONTS[number]["value"];
/** "default" = no personal override — the site font (Style Editor) shows through. */
export type FontChoice = FontValue | "default";

const KEY = "xt_font";

function getStored(): FontChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v && FONTS.some((f) => f.value === v)) return v as FontValue;
  } catch { /* ignore */ }
  return "default";
}

function applyFont(value: FontChoice) {
  const root = document.documentElement;
  const found = value === "default" ? undefined : FONTS.find((f) => f.value === value);
  if (!found) {
    // No personal override: clear the inline vars so the admin's served font
    // (Style Editor → Text & Fonts) applies. Overriding here by default was the
    // bug that made the site font invisible to every visitor.
    root.style.removeProperty("--ff-sans");
    root.style.removeProperty("--font-display");
    root.style.removeProperty("--font-headline");
    return;
  }
  // Personal override wins over the site font — body AND headings.
  root.style.setProperty("--ff-sans", found.stack);
  root.style.setProperty("--font-display", found.stack);
  root.style.setProperty("--font-headline", found.stack);
}

let _font: FontChoice = getStored();
const _listeners = new Set<() => void>();

function setFont(value: FontChoice) {
  _font = value;
  try {
    if (value === "default") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, value);
  } catch { /* ignore */ }
  applyFont(value);
  _listeners.forEach((fn) => fn());
}

function getSnapshot() { return _font; }
function subscribe(fn: () => void) { _listeners.add(fn); return () => _listeners.delete(fn); }

// Apply immediately on module load — before any React renders
if (typeof document !== "undefined") {
  applyFont(_font);
}

export function useFont() {
  const font = useSyncExternalStore(subscribe, getSnapshot);
  return { font, setFont };
}

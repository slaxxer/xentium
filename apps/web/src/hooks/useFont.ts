import { useSyncExternalStore } from "react";

export const FONTS = [
  { value: "Nunito",     label: "Nunito",     desc: "Warm & friendly (default)", stack: "Nunito, sans-serif"      },
  { value: "Raleway",    label: "Raleway",    desc: "Elegant, wide sans-serif",  stack: "Raleway, sans-serif"     },
  { value: "Montserrat", label: "Montserrat", desc: "Geometric & versatile",     stack: "Montserrat, sans-serif"  },
  { value: "Poppins",    label: "Poppins",    desc: "Geometric and friendly",    stack: "Poppins, sans-serif"     },
  { value: "Open Sans",  label: "Open Sans",  desc: "Clean, neutral & readable", stack: '"Open Sans", sans-serif' },
  { value: "Ubuntu",     label: "Ubuntu",     desc: "Humanist and approachable", stack: "Ubuntu, sans-serif"      },
  { value: "Roboto",     label: "Roboto",     desc: "Clean and universal",       stack: "Roboto, sans-serif"      },
] as const;

export type FontValue = typeof FONTS[number]["value"];

const KEY = "nv_font";
const DEFAULT: FontValue = "Nunito";

function getStored(): FontValue {
  try {
    const v = localStorage.getItem(KEY);
    if (v && FONTS.some((f) => f.value === v)) return v as FontValue;
  } catch { /* ignore */ }
  return DEFAULT;
}

function applyFont(value: FontValue) {
  const found = FONTS.find((f) => f.value === value);
  document.documentElement.style.setProperty("--ff-sans", found?.stack ?? "Nunito, sans-serif");
}

let _font: FontValue = getStored();
const _listeners = new Set<() => void>();

function setFont(value: FontValue) {
  _font = value;
  try { localStorage.setItem(KEY, value); } catch { /* ignore */ }
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

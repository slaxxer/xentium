import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AcpIcon, type AcpIconName } from "../pages/acpIcons";
// Palette routes come from the one nav definition — see ACP_NAV_INDEX.
import { ACP_NAV_INDEX as NAV_INDEX } from "../useAcpNav";
import { useDismiss } from "./useDismiss";

/**
 * The ACP command palette.
 *
 * One component for both chromes: the horizontal topbar gives it a 340px field
 * beside the breadcrumb, the rail layout puts the same field in the section
 * panel. Only the field's width differs, so the results list, the keyboard
 * handling and ⌘K are defined once.
 *
 * `align` decides which way the results panel grows. In the panel the field is
 * 224px wide and the list is wider than that, so it must be allowed to overhang
 * to the RIGHT, over the content area — anchoring it right-edge-first the way
 * the topbar does would push it off the left of the screen.
 */

interface PaletteItem {
  kind: "Navigation" | "Actions";
  id: string;
  label: string;
  sub: string;
  icon: AcpIconName;
  to?: string;
  run?: () => void;
}
const KIND_ORDER: PaletteItem["kind"][] = ["Actions", "Navigation"];

function highlight(label: string, q: string) {
  if (!q) return label;
  const i = label.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return label;
  return <>{label.slice(0, i)}<mark>{label.slice(i, i + q.length)}</mark>{label.slice(i + q.length)}</>;
}

export function AcpSearch({ align = "right", compact = false, variant = "field" }: {
  /** Which edge the results panel is pinned to. */
  align?: "left" | "right";
  /** Panel variant: shorter placeholder, field fills its column. */
  compact?: boolean;
  /** `rail`: an icon in the collapsed rail that opens the palette centred on screen. */
  variant?: "field" | "rail";
}) {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation("acp");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useDismiss<HTMLDivElement>(open, () => setOpen(false));

  const index: PaletteItem[] = useMemo(() => {
    const actions: PaletteItem[] = [
      { kind: "Actions", id: "Actions:viewSite", label: t("topbar.viewLiveSite"), sub: t("topbar.openPublicSite"), icon: "external", run: () => navigate("/") },
    ];
    // Pages reached only through another (the editors, through Themes) are not
    // destinations of their own.
    const nav: PaletteItem[] = NAV_INDEX.filter((n) => !n.parentKey).map((n) => ({
      kind: "Navigation", id: `Navigation:${n.to}`, label: t(n.labelKey), sub: t(n.subKey), icon: n.icon, to: n.to,
    }));
    return [...actions, ...nav];
  }, [navigate, t, i18n.language]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return index.slice(0, 7);
    return index.filter((it) => it.label.toLowerCase().includes(q) || it.sub.toLowerCase().includes(q)).slice(0, 9);
  }, [q, index]);

  const groups = useMemo(() => {
    const m: Record<string, PaletteItem[]> = {};
    filtered.forEach((it) => { (m[it.kind] ||= []).push(it); });
    return KIND_ORDER.filter((k) => m[k]).map((k) => [k, m[k]!] as const);
  }, [filtered]);
  const flat = useMemo(() => groups.flatMap(([, items]) => items), [groups]);

  useEffect(() => {
    if (!flat.length) { setActiveId(null); return; }
    if (!flat.some((it) => it.id === activeId)) setActiveId(flat[0]!.id);
  }, [flat, activeId]);

  const activate = useCallback((it: PaletteItem) => {
    setOpen(false); setQuery("");
    if (it.run) it.run();
    else if (it.to) navigate(it.to);
  }, [navigate]);

  // ⌘K / Ctrl+K opens + focuses the palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!flat.length) return;
    const i = Math.max(0, flat.findIndex((it) => it.id === activeId));
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveId(flat[(i + 1) % flat.length]!.id); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveId(flat[(i - 1 + flat.length) % flat.length]!.id); }
    else if (e.key === "Enter") { e.preventDefault(); if (flat[i]) activate(flat[i]!); }
  };

  const groupLabel = (kind: string) => kind === "Actions" ? t("topbar.groupActions") : t("topbar.groupNavigation");

  const body = (
    <>
      <div className="nbsearch__field" onClick={() => { setOpen(true); inputRef.current?.focus(); }}>
        <AcpIcon name="search" size={16} className="nbsearch__ic" />
        <input
          ref={inputRef}
          className="nbsearch__input"
          type="text"
          placeholder={compact ? t("topbar.searchPlaceholderShort") : t("topbar.searchPlaceholder")}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {query
          ? <button type="button" className="nbsearch__clear" aria-label={t("topbar.clear")} onClick={() => { setQuery(""); inputRef.current?.focus(); }}>×</button>
          : <kbd className="nbsearch__kbd">⌘K</kbd>}
      </div>

      {open && (
        <div className={`nbpal nbpal--${align}`}>
          {flat.length === 0 ? (
            <div className="nbpal__empty">
              <AcpIcon name="search" size={22} />
              <p>{t("topbar.noMatchesFor")} <b>{query.trim()}</b></p>
              <span>{t("topbar.tryPageOrAction")}</span>
            </div>
          ) : (
            <div className="nbpal__list">
              {!q && <div className="nbpal__hint">{t("topbar.jumpTo")}</div>}
              {groups.map(([kind, items]) => (
                <div className="nbpal__group" key={kind}>
                  <div className="nbpal__glabel">{groupLabel(kind)}</div>
                  {items.map((it) => {
                    const isAct = it.id === activeId;
                    return (
                      <button
                        key={it.id}
                        type="button"
                        className={`nbpal__item${isAct ? " is-active" : ""}`}
                        onMouseEnter={() => setActiveId(it.id)}
                        onClick={() => activate(it)}
                      >
                        <span className={`nbpal__ic nbpal__ic--${it.kind.toLowerCase()}`}>
                          <AcpIcon name={it.icon} size={16} />
                        </span>
                        <span className="nbpal__txt">
                          <b>{highlight(it.label, query.trim())}</b>
                          <span>{it.sub}</span>
                        </span>
                        {it.run
                          ? <span className="nbpal__tag">{t("topbar.run")}</span>
                          : <AcpIcon name="cornerDown" size={14} className="nbpal__enter" />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
          <div className="nbpal__foot">
            <span><kbd>↑</kbd><kbd>↓</kbd> {t("topbar.footNavigate")}</span>
            <span><kbd>↵</kbd> {t("topbar.footOpen")}</span>
            <span><kbd>esc</kbd> {t("topbar.footClose")}</span>
          </div>
        </div>
      )}
    </>
  );

  // Rail variant: the panel is collapsed, so there is no column for a field.
  // An icon in the rail opens the same field and results as a centred palette.
  if (variant === "rail") {
    return (
      <div className={`nbsearch nbsearch--rail${open ? " is-open" : ""}`} ref={wrapRef}>
        <button
          type="button"
          className="acp-rail__util"
          title={t("topbar.searchPlaceholderShort")}
          aria-label={t("topbar.searchPlaceholderShort")}
          onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }}
        >
          <AcpIcon name="search" size={18} />
        </button>
        {open && <div className="nbsearch__panel">{body}</div>}
      </div>
    );
  }

  return (
    <div className={`nbsearch${open ? " is-open" : ""}${compact ? " nbsearch--compact" : ""}`} ref={wrapRef}>
      {body}
    </div>
  );
}

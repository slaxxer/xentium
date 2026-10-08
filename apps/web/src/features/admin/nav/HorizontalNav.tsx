import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AcpIcon } from "../pages/acpIcons";
import { XentiumMark } from "../../../components/XentiumMark";
import { childMatches, type NavItem } from "../useAcpNav";

// Two-tier horizontal ACP nav (the redesign default). Tier 1 = brand + primary
// menu (groups open a dropdown of their pages; leaf items navigate directly).
// Tier 2 = a context strip showing the active section + its pages as tabs.
// The util cluster (search / notifications / user) lives in the reused AcpTopbar.

function useOutside<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open, onClose]);
  return ref;
}

function isItemActive(item: NavItem, path: string): boolean {
  if (item.to) return item.to === "/admin" ? path === "/admin" : path.startsWith(item.to);
  return !!item.children?.some((c) => childMatches(c, path));
}

function PrimaryCell({ item, active, openKey, setOpenKey }: {
  item: NavItem; active: boolean; openKey: string | null; setOpenKey: (k: string | null) => void;
}) {
  const { t } = useTranslation("acp");
  const id = item.key ?? item.to ?? item.label;
  const isOpen = openKey === id;
  const ref = useOutside<HTMLDivElement>(isOpen, () => setOpenKey(null));
  const path = useLocation().pathname;

  if (!item.children) {
    return (
      <Link to={item.to!} className={`hnav__item${active ? " is-section" : ""}`}>
        <span className="hnav__ic">{item.icon}</span>
        <span className="hnav__lbl">{t(item.label)}</span>
      </Link>
    );
  }

  return (
    <div className={`hnav__cell${isOpen ? " is-open" : ""}`} ref={ref}>
      <button type="button" className={`hnav__item${active ? " is-section" : ""}`} onClick={() => setOpenKey(isOpen ? null : id)}>
        <span className="hnav__ic">{item.icon}</span>
        <span className="hnav__lbl">{t(item.label)}</span>
        <AcpIcon name="chevron" size={13} className="hnav__chev" />
      </button>
      {isOpen && (
        <div className="hnav__drop">
          <div className="hnav__droplabel">{t(item.label)}</div>
          {item.children.map((c) => {
            const act = childMatches(c, path);
            return (
              <Link key={c.to} to={c.to} className={`hnav__dropitem${act ? " is-active" : ""}`} onClick={() => setOpenKey(null)}>
                <span className="hnav__dropic">{item.icon}</span>
                <b>{t(c.label)}</b>
                {act && <AcpIcon name="check" size={15} className="hnav__dropmark" />}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function HorizontalNav({ nav }: { nav: NavItem[] }) {
  const { t } = useTranslation("acp");
  const path = useLocation().pathname;
  const [openKey, setOpenKey] = useState<string | null>(null);

  const section = nav.find((n) => isItemActive(n, path)) ?? nav[0];

  return (
    <>
      <header className="hnav">
        <div className="hnav__brand">
          <XentiumMark size={34} title="Xentium" brand />
          <div>
            <div className="hnav__name">xentium</div>
            <div className="hnav__tag">{t("sidebar.adminPanel")}</div>
          </div>
        </div>
        <span className="hnav__div" />
        <nav className="hnav__menu acp-scroll">
          {nav.map((item) => (
            <PrimaryCell
              key={item.key ?? item.to ?? item.label}
              item={item}
              active={section === item}
              openKey={openKey}
              setOpenKey={setOpenKey}
            />
          ))}
        </nav>
      </header>

      {section?.children && (
        <div className="hctx">
          <div className="hctx__id">
            <span className="hctx__icon">{section.icon}</span>
            <span className="hctx__name">{t(section.label)}</span>
          </div>
          <span className="hctx__div" />
          <div className="hctx__tabs acp-scroll">
            {section.children.map((c) => {
              const act = childMatches(c, path);
              return (
                <Link key={c.to} to={c.to} className={`hctx__tab${act ? " is-active" : ""}`}>
                  {t(c.label)}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

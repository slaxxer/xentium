import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AcpIcon } from "../pages/acpIcons";
import type { NavItem } from "../useAcpNav";

// Slim icon rail (74px) with hover flyouts — pairs with the reused AcpTopbar.
// Each cell shows its section icon; hovering reveals a flyout with the section's
// pages. Leaf items navigate on click.

function isItemActive(item: NavItem, path: string): boolean {
  if (item.to) return item.to === "/admin" ? path === "/admin" : path.startsWith(item.to);
  return !!item.children?.some((c) => path.startsWith(c.to));
}

function RailCell({ item }: { item: NavItem }) {
  const { t } = useTranslation("acp");
  const path = useLocation().pathname;
  const active = isItemActive(item, path);

  const button = item.to
    ? <Link to={item.to} className={`rail__item${active ? " is-section" : ""}`} title={t(item.label)}>{item.icon}</Link>
    : <button type="button" className={`rail__item${active ? " is-section" : ""}`} title={t(item.label)}>{item.icon}</button>;

  return (
    <div className="rail__cell">
      {button}
      <div className="rail__flyout">
        <div className="rail__fly-h">{t(item.label)}</div>
        {item.children?.map((c) => {
          const act = path.startsWith(c.to);
          return (
            <Link key={c.to} to={c.to} className={`rail__fly-item${act ? " is-active" : ""}`}>
              {t(c.label)}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function IconRail({ nav }: { nav: NavItem[] }) {
  return (
    <aside className="rail">
      <div className="rail__brand"><AcpIcon name="dashboard" size={20} /></div>
      <nav className="rail__nav acp-scroll">
        {nav.map((item) => <RailCell key={item.key ?? item.to ?? item.label} item={item} />)}
      </nav>
    </aside>
  );
}

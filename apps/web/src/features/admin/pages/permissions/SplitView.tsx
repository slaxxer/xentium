import { useEffect, useRef, useState, type RefObject } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  faChevronDown, faCopy, faLink, faLock, faMagnifyingGlass, faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../../../components/Icon";
import { DEFAULT_BADGE_COLOR, isSensitive, powerOf, type Group } from "../groups/groupModel";
import { GroupGlyph, PowerMeter } from "../groups/groupParts";
import type { PermissionsCtx } from "../PermissionsPage";
import { changeOf, effectiveKeys, impliedBy, matchesQuery, type SplitFilter } from "./permissionsModel";
import { ToggleGlyph } from "../../../../components/Toggle";
import { permissionDomainLabel } from "../../../../lib/coreText";
import { Button } from "../../../../components/AcpControls";

const FILTERS: SplitFilter[] = ["all", "granted", "off", "sensitive", "changed"];

export const colorOf = (g: Group) => g.progression?.badgeColor || DEFAULT_BADGE_COLOR;

export function SplitView({ ctx, selected, onSelect, searchRef }: {
  ctx: PermissionsCtx;
  selected: Group;
  onSelect: (g: Group) => void;
  searchRef: RefObject<HTMLInputElement | null>;
}) {
  const { t } = useTranslation("acp");
  const { domains, total, saved, draft, edits, request, copyFrom } = ctx;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SplitFilter>("all");
  // Domains start CLOSED: the page opens on one line per domain with its count, and
  // the admin opens the one they came for. Searching or filtering opens every match.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const gid = selected.id;
  const held = draft(gid);
  const eff = effectiveKeys(held);
  const base = saved(gid);
  const mine = edits[gid];

  const passes: Record<SplitFilter, (key: string) => boolean> = {
    all: () => true,
    granted: (k) => eff.has(k),
    off: (k) => !eff.has(k),
    sensitive: isSensitive,
    changed: (k) => !!changeOf(base, mine, k),
  };
  const all = domains.flatMap(([, ps]) => ps);
  const countFor = (f: SplitFilter) => all.filter((p) => matchesQuery(p, query) && passes[f](p.key)).length;
  const narrowing = !!query.trim() || filter !== "all";
  const visible = domains
    .map(([d, ps]) => [d, ps, ps.filter((p) => matchesQuery(p, query) && passes[filter](p.key))] as const)
    .filter(([, , shown]) => shown.length > 0);

  return (
    <div className="pm-split">
      <GroupList ctx={ctx} selectedId={gid} onSelect={onSelect} />

      <section className="gp-card pm-perms">
        <GroupHeader ctx={ctx} group={selected} count={eff.size} total={total} onCopy={(src) => copyFrom(gid, src)} />

        {held.has("admin.access") && (
          <div className="pm-admin-warn">
            <FontAwesomeIcon icon={faTriangleExclamation} className="pm-ic" />
            <span><code>admin.access</code> {t("permissions.adminWarning")}</span>
          </div>
        )}

        <div className="pm-toolbar">
          <label className="pm-search">
            <FontAwesomeIcon icon={faMagnifyingGlass} className="pm-ic" />
            <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("permissions.search")}
              onKeyDown={(e) => { if (e.key === "Escape") { setQuery(""); e.currentTarget.blur(); } }} />
            <kbd className="pm-kbd">/</kbd>
          </label>
          <div className="pm-filters" role="tablist">
            {FILTERS.map((f) => (
              <button key={f} type="button" role="tab" aria-selected={filter === f} className={filter === f ? "is-on" : ""} onClick={() => setFilter(f)}>
                {t(`permissions.filter.${f}`)} <span className="pm-filters__n">{countFor(f)}</span>
              </button>
            ))}
          </div>
        </div>

        {visible.length === 0 && (
          <div className="pm-empty">
            <p>{t("permissions.noMatch")}</p>
            <Button variant="ghost" onClick={() => { setQuery(""); setFilter("all"); }}>{t("permissions.clearFilters")}</Button>
          </div>
        )}

        {visible.map(([domain, ps, shown]) => {
          const on = ps.filter((p) => eff.has(p.key)).length;
          const allHeld = ps.every((p) => held.has(p.key));
          const sens = ps.filter((p) => isSensitive(p.key)).length;
          const open = narrowing || !!expanded[domain];
          return (
            <div key={domain} className="pm-domain">
              <div className="pm-domain__head">
                <button type="button" className="pm-domain__toggle" aria-expanded={open} disabled={narrowing}
                  onClick={() => setExpanded((c) => ({ ...c, [domain]: !c[domain] }))}>
                  <FontAwesomeIcon icon={faChevronDown} className={`gp-chev${open ? "" : " is-closed"}`} />
                  <span className="gp-domain__name">{permissionDomainLabel(domain)}</span>
                  {sens > 0 && <span className="gp-sensitive">{t("permissions.sensitiveCount", { count: sens })}</span>}
                </button>
                <button type="button" className="gp-domain__all" onClick={() => request(gid, ps.map((p) => p.key), !allHeld)}>
                  {allHeld ? t("groups.perms.revokeAll") : t("groups.perms.grantAll")}
                </button>
                <span className="gp-fill" aria-hidden><span style={{ width: `${Math.round((on / ps.length) * 100)}%` }} /></span>
                <span className="gp-domain__count">{on}/{ps.length}</span>
              </div>
              {open && (
                <div className="pm-tiles">
                  {shown.map((p) => {
                    const isHeld = held.has(p.key);
                    const via = impliedBy(held, p.key);
                    const change = changeOf(base, mine, p.key);
                    const cls = `pm-tile${isHeld ? " is-on" : via ? " is-implied" : ""}`;
                    return (
                      <button key={p.key} type="button" className={cls} role="switch" aria-checked={isHeld || !!via}
                        aria-disabled={!!via} title={via ? t("permissions.impliedHint", { key: via }) : undefined}
                        onClick={via ? undefined : () => request(gid, [p.key], !isHeld)}>
                        <span className="pm-tile__main">
                          <span className="pm-tile__line">
                            <span className="pm-tile__label">{p.label}</span>
                            {isSensitive(p.key) && (
                              <span className="gp-sensitive" title={t("permissions.sensitiveHint")}>
                                <FontAwesomeIcon icon={faTriangleExclamation} className="pm-ic" /> {t("permissions.sensitive")}
                              </span>
                            )}
                            {change && <span className={`pm-change pm-change--${change}`}>{t(change === "grant" ? "permissions.willGrant" : "permissions.willRevoke")}</span>}
                          </span>
                          <code className="pm-tile__key">{p.key}</code>
                          {via && (
                            <span className="pm-tile__via"><FontAwesomeIcon icon={faLink} className="pm-ic" /> {t("permissions.impliedBy", { key: via })}</span>
                          )}
                        </span>
                        {via && <FontAwesomeIcon icon={faLock} className="pm-ic pm-tile__lock" />}
                        <ToggleGlyph on={isHeld} implied={!isHeld && !!via} />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}

function GroupList({ ctx, selectedId, onSelect }: { ctx: PermissionsCtx; selectedId: string; onSelect: (g: Group) => void }) {
  const { t } = useTranslation("acp");
  const { groups, total, draft, edits } = ctx;
  return (
    <aside className="gp-card pm-groups">
      <div className="pm-groups__head">
        <span className="gp-section">{t("permissions.groups")}</span>
        <span className="pm-groups__sub">{t("permissions.byPrecedence")}</span>
      </div>
      <div className="pm-groups__list">
        {groups.map((g) => {
          const held = draft(g.id);
          const eff = effectiveKeys(held);
          return (
            <button key={g.id} type="button" className={`pm-grow${g.id === selectedId ? " is-on" : ""}`} onClick={() => onSelect(g)}
              aria-current={g.id === selectedId ? "true" : undefined}>
              <GroupGlyph color={colorOf(g)} />
              <span className="pm-grow__main">
                <span className="pm-grow__name">
                  {g.name}
                  {edits[g.id] && <span className="pm-dirty" title={t("permissions.groupDirty")} />}
                </span>
                <span className="pm-grow__sub">{t("groups.memberCount", { count: g._count.users })}</span>
              </span>
              <span className="pm-grow__power">
                <span className="pm-grow__count">{eff.size}/{total}</span>
                <PowerMeter power={powerOf([...eff])} compact />
              </span>
            </button>
          );
        })}
      </div>
      <Link to="/admin/groups" className="pm-groups__foot">{t("permissions.createOrReorder")}</Link>
    </aside>
  );
}

function GroupHeader({ ctx, group, count, total, onCopy }: {
  ctx: PermissionsCtx; group: Group; count: number; total: number; onCopy: (sourceId: string) => void;
}) {
  const { t } = useTranslation("acp");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const eff = effectiveKeys(ctx.draft(group.id));

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  useEffect(() => setOpen(false), [group.id]);

  return (
    <div className="pm-ghead">
      <GroupGlyph color={colorOf(group)} size="lg" />
      <div className="pm-ghead__titles">
        <div className="gp-detail-head__line">
          <h2 className="pm-ghead__name">{group.name}</h2>
          {group.isSystem && <span className="gp-protected"><FontAwesomeIcon icon={faLock} className="pm-ic" /> {t("permissions.system")}</span>}
        </div>
        <div className="gp-detail-head__meta">
          <code>{group.key}</code>
          <span>{t("groups.memberCount", { count: group._count.users })}</span>
          <span>{t("permissions.grantedOf", { granted: count, total })}</span>
        </div>
      </div>
      <div className="pm-ghead__side">
        <PowerMeter power={powerOf([...eff])} />
        <div className="pm-copy" ref={ref}>
          <Button variant="ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <FontAwesomeIcon icon={faCopy} className="pm-ic" /> {t("permissions.copyFrom")}
          </Button>
          {open && (
            <div className="pm-copy__menu" role="menu">
              <p className="gp-section">{t("permissions.copyTitle")}</p>
              {ctx.groups.filter((g) => g.id !== group.id).map((g) => (
                <button key={g.id} type="button" role="menuitem" className="pm-copy__item" onClick={() => { setOpen(false); onCopy(g.id); }}>
                  <GroupGlyph color={colorOf(g)} size="sm" />
                  <span className="pm-copy__name">{g.name}</span>
                  <span className="pm-grow__count">{effectiveKeys(ctx.draft(g.id)).size}</span>
                </button>
              ))}
              <p className="pm-copy__note">{t("permissions.copyNote")}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

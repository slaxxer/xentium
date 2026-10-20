import { useState, type CSSProperties, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { faCheck, faMagnifyingGlass, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../../../components/Icon";
import { isSensitive, powerOf, type Group } from "../groups/groupModel";
import { GroupGlyph, PowerMeter } from "../groups/groupParts";
import type { PermissionsCtx } from "../PermissionsPage";
import { changeOf, effectiveKeys, impliedBy, matchesQuery, type MatrixFilter } from "./permissionsModel";
import { colorOf } from "./SplitView";
import { permissionDomainLabel } from "../../../../lib/coreText";
import { Button } from "../../../../components/AcpControls";

const FILTERS: MatrixFilter[] = ["all", "sensitive", "changed"];

/** Permissions down, groups across: one checkbox per pair. */
export function MatrixView({ ctx, onOpen, searchRef }: {
  ctx: PermissionsCtx;
  onOpen: (g: Group) => void;
  searchRef: RefObject<HTMLInputElement | null>;
}) {
  const { t } = useTranslation("acp");
  const { groups, domains, saved, draft, edits, request } = ctx;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MatrixFilter>("all");

  const held = new Map(groups.map((g) => [g.id, draft(g.id)]));
  const eff = new Map(groups.map((g) => [g.id, effectiveKeys(held.get(g.id)!)]));
  const changedAnywhere = (k: string) => groups.some((g) => !!changeOf(saved(g.id), edits[g.id], k));
  const passes: Record<MatrixFilter, (k: string) => boolean> = { all: () => true, sensitive: isSensitive, changed: changedAnywhere };
  const all = domains.flatMap(([, ps]) => ps);
  const countFor = (f: MatrixFilter) => all.filter((p) => matchesQuery(p, query) && passes[f](p.key)).length;
  const visible = domains
    .map(([d, ps]) => [d, ps, ps.filter((p) => matchesQuery(p, query) && passes[filter](p.key))] as const)
    .filter(([, , shown]) => shown.length > 0);

  const grid = { "--pm-cols": groups.length } as CSSProperties;

  return (
    <section className="gp-card pm-matrix">
      <div className="pm-toolbar">
        <label className="pm-search pm-search--narrow">
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
        <div className="pm-legend" aria-hidden>
          <span><i className="pm-cell is-on" /> {t("permissions.legendGranted")}</span>
          <span><i className="pm-cell is-implied" /> {t("permissions.legendImplied")}</span>
          <span><i className="pm-cell is-grant" /> {t("permissions.legendUnsaved")}</span>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="pm-empty">
          <p>{t("permissions.noMatch")}</p>
          <Button variant="ghost" onClick={() => { setQuery(""); setFilter("all"); }}>{t("permissions.clearFilters")}</Button>
        </div>
      ) : (
        <div className="pm-mx" style={grid}>
          <div className="pm-mx__row pm-mx__row--head">
            <div className="pm-mx__first">
              <span className="gp-section">{t("permissions.colPermission")}</span>
              <span className="pm-mx__hint">{t("permissions.colHint")}</span>
            </div>
            {groups.map((g) => (
              <button key={g.id} type="button" className="pm-mx__col" onClick={() => onOpen(g)} title={g.name}>
                <span className="pm-mx__glyph">
                  <GroupGlyph color={colorOf(g)} size="sm" />
                  {edits[g.id] && <span className="pm-dirty pm-dirty--corner" />}
                </span>
                <span className="pm-mx__gname">{g.name}</span>
                <span className="pm-mx__gsub">{g._count.users}</span>
                <PowerMeter power={powerOf([...eff.get(g.id)!])} compact />
              </button>
            ))}
          </div>

          {visible.map(([domain, ps, shown]) => (
            <div key={domain} className="pm-mx__group">
              <div className="pm-mx__row pm-mx__row--domain">
                <div className="pm-mx__first">
                  <span className="gp-domain__name">{permissionDomainLabel(domain)}</span>
                  <span className="pm-mx__hint">{ps.length}</span>
                </div>
                {groups.map((g) => {
                  const on = ps.filter((p) => eff.get(g.id)!.has(p.key)).length;
                  const full = ps.every((p) => held.get(g.id)!.has(p.key));
                  return (
                    <button key={g.id} type="button" className={`pm-mx__dom${on ? " is-some" : ""}`}
                      title={t(full ? "permissions.revokeDomain" : "permissions.grantDomain", { domain: permissionDomainLabel(domain), group: g.name })}
                      onClick={() => request(g.id, ps.map((p) => p.key), !full)}>
                      <span>{on}/{ps.length}</span>
                      <span className="gp-fill pm-mx__fill" aria-hidden><span style={{ width: `${Math.round((on / ps.length) * 100)}%` }} /></span>
                    </button>
                  );
                })}
              </div>

              {shown.map((p) => (
                <div key={p.key} className="pm-mx__row">
                  <div className="pm-mx__first pm-mx__perm">
                    <span className="pm-mx__label">
                      {p.label}
                      {isSensitive(p.key) && <span className="pm-mx__sens" title={t("permissions.sensitive")}><FontAwesomeIcon icon={faTriangleExclamation} className="pm-ic" /></span>}
                    </span>
                    <code className="pm-tile__key">{p.key}</code>
                  </div>
                  {groups.map((g) => {
                    const h = held.get(g.id)!;
                    const isHeld = h.has(p.key);
                    const via = impliedBy(h, p.key);
                    const change = changeOf(saved(g.id), edits[g.id], p.key);
                    const title = via
                      ? t("permissions.cellImplied", { group: g.name, key: via })
                      : t(isHeld ? (change ? "permissions.cellGrantedUnsaved" : "permissions.cellGranted")
                                 : (change ? "permissions.cellOffUnsaved" : "permissions.cellOff"), { group: g.name });
                    return (
                      <div key={g.id} className="pm-mx__cellwrap">
                        <button type="button" role="checkbox" aria-checked={isHeld || !!via} aria-disabled={!!via} aria-label={title} title={title}
                          className={`pm-cell${isHeld ? " is-on" : via ? " is-implied" : ""}${change ? ` is-${change}` : ""}`}
                          onClick={via ? undefined : () => request(g.id, [p.key], !isHeld)}>
                          {(isHeld || via) && <FontAwesomeIcon icon={faCheck} className="pm-ic" />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

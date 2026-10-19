import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "../../../components/Icon";
import {
  faArrowRight, faArrowUpRightFromSquare, faCopy, faEllipsis, faMagnifyingGlass, faPuzzlePiece,
  faRectangleList, faSliders, faTrashCan, faTriangleExclamation, faUpload, faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { apiErrorMessage } from "../../../lib/swal";
import { toast } from "../../../lib/toast";
import { Toggle } from "../../../components/Toggle";
import { slotRegistry } from "../../../plugins/slotRegistry";
import { listBlocks } from "../../../layout/blockRegistry";
import { pluginText } from "../../../lib/coreText";
import { siteTime } from "../../../lib/datetime";
import { ExtensionsUpdateBanner } from "../components/ExtensionsUpdateBanner";
import { TrustBadge } from "../components/TrustBadge";
import { useUploadAllowed, UPLOAD_ALLOWED_KEY } from "../hooks/useUploadAllowed";
import "./InstalledPage.scss";

interface InstalledPlugin {
  id:               string;
  name:             string;
  vendor:           string;
  installedVersion: string;
  status:           string;
  licenseRequired:  boolean;
  /** Which review the package carried, or null when it carried no signature. */
  signatureTier:    string | null;
  /** Null only for a plugin installed before provenance was recorded at all. */
  contentDigest:    string | null;
  installedAt:      string;
  loadError:        { hook: string; message: string; at: string } | null;
  /** Its storefront listing; null for a build the marketplace did not sign. */
  storeUrl:         string | null;
  manifest:         { tablePrefix?: string; permissions?: string[]; migrations?: string[] } | null;
}

interface RegisteredPage { section: string; label: string; path: string; pluginId: string }

/** `failed` = switched on, but its onEnable/import threw, so it registered nothing. */
type Kind = "enabled" | "disabled" | "installed" | "failed";
type Filter = "all" | "enabled" | "off" | "issues";

const QK = ["acp-installed-plugins"] as const;
/** Below this the detail panel slides over the list instead of sitting beside it. */
const DOCK_QUERY = "(min-width: 1080px)";

function kindOf(p: InstalledPlugin): Kind {
  if (p.status === "enabled") return p.loadError ? "failed" : "enabled";
  return p.status === "disabled" ? "disabled" : "installed";
}

function useDocked(): boolean {
  const [docked, setDocked] = useState(() => typeof window === "undefined" || window.matchMedia(DOCK_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(DOCK_QUERY);
    const on = () => setDocked(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return docked;
}

/**
 * What each plugin contributes, as far as this browser can see.
 *
 * ACP pages come from the server (the same list the ACP menu reads); blocks and the
 * smaller hooks come from the registries its web bundle filled in. A plugin that is
 * off has loaded no bundle, so only what its MANIFEST declares (permissions) is
 * known, and the panel says the rest appears once it is on.
 */
interface Contribution { pages: { label: string; path: string }[]; blocks: string[]; also: string[] }

function useContributions(pages: RegisteredPage[]): (id: string) => Contribution {
  const { t } = useTranslation("acp");
  return useMemo(() => {
    const blocks = listBlocks();
    const owner = (key: string) => slotRegistry.ownerOf(key);
    return (id: string) => {
      const also: string[] = [];
      const add = (n: number, key: string) => { if (n) also.push(t(key, { count: n })); };
      add(slotRegistry.getRoutes("public").filter((r) => owner(r.path) === id).length, "installed.also.publicPages");
      add(slotRegistry.getSearchTabs().filter((s) => owner(s.id) === id).length, "installed.also.searchSources");
      add(slotRegistry.getHeaderWidgets().filter((s) => owner(s.id) === id).length, "installed.also.headerWidgets");
      add(slotRegistry.getProfileTabs().filter((s) => owner(s.id) === id).length, "installed.also.profileTabs");
      add(slotRegistry.getGroupConfigPanels().filter((s) => owner(s.id) === id).length, "installed.also.groupPanels");
      add(slotRegistry.getUserMenuItems().filter((s) => owner(s.id) === id).length, "installed.also.userMenuItems");
      return {
        pages: pages
          .filter((p) => p.pluginId === id)
          .map((p) => ({ label: pluginText(`acpPages.${p.path.replace(/^\/admin\//, "")}`, p.label), path: p.path })),
        blocks: blocks.filter((b) => b.pluginId === id).map((b) => b.editorMeta?.label ?? b.type),
        also,
      };
    };
  }, [pages, t]);
}

export function InstalledPage() {
  const { t } = useTranslation("acp");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const docked = useDocked();

  const { data: plugins = [], isLoading } = useQuery<InstalledPlugin[]>({
    queryKey: QK,
    queryFn:  () => api.get("/plugins"),
  });
  const { data: registeredPages = [] } = useQuery<RegisteredPage[]>({
    queryKey: ["acp-registered-pages"],
    queryFn:  () => api.get("/admin/registered-pages"),
    staleTime: 60_000,
  });
  const contributions = useContributions(registeredPages);

  const [query, setQuery]       = useState("");
  const [filter, setFilter]     = useState<Filter>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [menuId, setMenuId]     = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [removeData, setRemoveData] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  // The row menu closes on any click elsewhere and on Escape.
  useEffect(() => {
    if (!menuId) return;
    const close = () => setMenuId(null);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("click", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("click", close); document.removeEventListener("keydown", esc); };
  }, [menuId]);

  // A removed (or filtered-away) plugin cannot stay selected or open.
  useEffect(() => {
    const ids = new Set(plugins.map((p) => p.id));
    setSelected((s) => s.filter((id) => ids.has(id)));
    if (activeId && !ids.has(activeId)) setActiveId(null);
  }, [plugins, activeId]);

  const { data: uploadAllowed } = useUploadAllowed();
  const toggleUploadMut = useMutation({
    mutationFn: (val: boolean) => api.put("/admin/settings/plugins.allow_upload", { value: val }),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: UPLOAD_ALLOWED_KEY }); },
    onError:    (e) => toast.error(apiErrorMessage(e)),
  });

  /** One call per plugin, in order; the list refreshes once at the end. */
  const run = async (ids: string[], call: (id: string) => Promise<unknown>, done: string) => {
    setBusy((b) => new Set([...b, ...ids]));
    let ok = 0;
    for (const id of ids) {
      try { await call(id); ok++; }
      catch (e) { toast.error(apiErrorMessage(e)); }
    }
    setBusy((b) => { const n = new Set(b); ids.forEach((id) => n.delete(id)); return n; });
    await qc.invalidateQueries({ queryKey: QK });
    qc.invalidateQueries({ queryKey: ["acp-registered-pages"] });
    if (ok) toast.success(t(done, { count: ok }));
  };
  const setOn = (ids: string[], on: boolean) =>
    run(ids, (id) => api.post(`/plugins/${id}/${on ? "enable" : "disable"}`, {}), on ? "installed.toastEnabled" : "installed.toastDisabled");
  const remove = async (ids: string[], withData: boolean) => {
    await run(ids, (id) => api.delete(`/plugins/${id}?removeData=${withData}`), "installed.toastRemoved");
    setConfirmId(null); setRemoveData(false); setBulkConfirm(false);
    setSelected((s) => s.filter((id) => !ids.includes(id)));
  };

  // ── Derived ──────────────────────────────────────────────────────────────
  const counts = useMemo(() => {
    const c = { all: plugins.length, enabled: 0, off: 0, issues: 0 };
    for (const p of plugins) {
      const k = kindOf(p);
      if (k === "enabled") c.enabled++; else if (k === "failed") c.issues++; else c.off++;
    }
    return c;
  }, [plugins]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return plugins.filter((p) => {
      const k = kindOf(p);
      if (filter === "enabled" && k !== "enabled") return false;
      if (filter === "off" && k !== "disabled" && k !== "installed") return false;
      if (filter === "issues" && k !== "failed") return false;
      return !q || [p.name, p.id, p.vendor].some((v) => v.toLowerCase().includes(q));
    });
  }, [plugins, query, filter]);

  const visIds = visible.map((p) => p.id);
  const allChecked = visIds.length > 0 && visIds.every((id) => selected.includes(id));
  const someChecked = !allChecked && visIds.some((id) => selected.includes(id));
  const active = plugins.find((p) => p.id === activeId) ?? null;

  const summary = (p: InstalledPlugin): string => {
    if (kindOf(p) === "failed") return t("installed.rowFailed");
    const c = contributions(p.id);
    const perms = p.manifest?.permissions?.length ?? 0;
    const parts: string[] = [];
    if (c.pages.length) parts.push(t("installed.summary.pages", { count: c.pages.length }));
    if (c.blocks.length) parts.push(t("installed.summary.blocks", { count: c.blocks.length }));
    if (perms) parts.push(t("installed.summary.permissions", { count: perms }));
    if (c.also.length) parts.push(t("installed.summary.more", { count: c.also.length }));
    return parts.join(" · ") || t("installed.meta", { id: p.id, date: siteTime.date(p.installedAt) });
  };

  const open = (id: string) => { setActiveId(id); setMenuId(null); setConfirmId(null); setRemoveData(false); };
  const stop = (e: MouseEvent) => e.stopPropagation();

  // ── Render ───────────────────────────────────────────────────────────────
  const header = (
    <div className="acp-page-header">
      <div className="acp-page-header__left">
        <div className="acp-page-sub">{t("nav.extensions")}</div>
        <h1 className="acp-page-title">{t("installed.title")}</h1>
        {plugins.length > 0 && (
          <p className="ipl-headline">
            {t("installed.headline", { installed: plugins.length, enabled: counts.enabled })}
            {counts.issues > 0 && <> · <span className="ipl-headline__bad">{t("installed.headlineFailed", { count: counts.issues })}</span></>}
          </p>
        )}
      </div>
      <div className="ipl-upload">
        <label className="ipl-upload__toggle" title={t("installed.allowUploadHint")}>
          <Toggle
            on={uploadAllowed === true}
            onToggle={() => toggleUploadMut.mutate(!uploadAllowed)}
            disabled={toggleUploadMut.isPending}
            label={t("installed.allowUpload")}
          />
          <span>{t("installed.allowUpload")}</span>
        </label>
        {uploadAllowed === true && (
          <button type="button" className="btn-primary btn-sm" onClick={() => navigate("/admin/upload")}>
            <FontAwesomeIcon icon={faUpload} /> {t("installed.uploadBtn")}
          </button>
        )}
      </div>
    </div>
  );

  if (isLoading) {
    return <div>{header}<div className="acp-card acp-empty">{t("installed.loading")}</div></div>;
  }

  if (plugins.length === 0) {
    return (
      <div>
        {header}
        <ExtensionsUpdateBanner />
        <div className="acp-card ipl-none">
          <FontAwesomeIcon icon={faPuzzlePiece} className="ipl-none__ic" />
          <div className="ipl-none__title">{t("installed.emptyTitle")}</div>
          <div className="ipl-none__hint">{t("installed.emptyHint")}</div>
          {uploadAllowed === true ? (
            <button type="button" className="btn-primary btn-sm" onClick={() => navigate("/admin/upload")}>{t("installed.uploadBtn")}</button>
          ) : (
            <button type="button" className="btn-primary btn-sm" onClick={() => navigate("/admin/marketplace")}>{t("installed.emptyBrowseMarketplace")}</button>
          )}
        </div>
      </div>
    );
  }

  const withPanel = !!active && docked;
  const filters: Filter[] = counts.issues ? ["all", "enabled", "off", "issues"] : ["all", "enabled", "off"];

  return (
    <div className="ipl">
      {header}
      <ExtensionsUpdateBanner />

      <div className={`ipl-grid${withPanel ? " has-panel" : ""}`}>
        <section className="ipl-list" aria-label={t("installed.title")}>
          {selected.length === 0 ? (
            <div className="ipl-bar">
              <label className="ipl-search">
                <FontAwesomeIcon icon={faMagnifyingGlass} className="ipl-search__ic" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("installed.searchPlaceholder")}
                  aria-label={t("installed.searchPlaceholder")}
                />
              </label>
              <div className="ipl-seg" role="tablist" aria-label={t("installed.filterLabel")}>
                {filters.map((f) => (
                  <button
                    key={f}
                    type="button"
                    role="tab"
                    aria-selected={filter === f}
                    className={`${filter === f ? "is-on" : ""}${f === "issues" ? " is-bad" : ""}`}
                    onClick={() => setFilter(f)}
                  >
                    {t(`installed.filter.${f}`)}<span className="ipl-seg__n">{counts[f]}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="ipl-bulk">
              <span className="ipl-bulk__count">{t("installed.selected", { count: selected.length })}</span>
              <span className="ipl-bulk__sep" />
              <button type="button" className="ipl-mini" onClick={() => setOn(selected, true)}>{t("installed.enable")}</button>
              <button type="button" className="ipl-mini" onClick={() => setOn(selected, false)}>{t("installed.disable")}</button>
              <button type="button" className="ipl-mini ipl-mini--danger" onClick={() => setBulkConfirm(true)}>{t("installed.removeEllipsis")}</button>
              <button type="button" className="ipl-mini ipl-mini--quiet ipl-bulk__clear" onClick={() => { setSelected([]); setBulkConfirm(false); }}>
                {t("installed.clear")} <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
          )}
          {bulkConfirm && selected.length > 0 && (
            <div className="ipl-confirm" role="alert">
              <FontAwesomeIcon icon={faTriangleExclamation} className="ipl-confirm__ic" />
              <span className="ipl-confirm__text">{t("installed.bulkRemoveText", { count: selected.length })}</span>
              <button type="button" className="ipl-mini" onClick={() => setBulkConfirm(false)}>{t("installed.cancel")}</button>
              <button type="button" className="ipl-mini ipl-mini--solid-danger" onClick={() => remove(selected, false)}>{t("installed.remove")}</button>
            </div>
          )}

          <div className={`ipl-row ipl-row--head${withPanel ? " no-vendor" : ""}`}>
            <input
              type="checkbox"
              className="ipl-check"
              checked={allChecked}
              ref={(el) => { if (el) el.indeterminate = someChecked; }}
              onChange={() => setSelected((s) => allChecked ? s.filter((id) => !visIds.includes(id)) : [...new Set([...s, ...visIds])])}
              aria-label={t("installed.selectAll")}
            />
            <div>{t("installed.col.plugin")}</div>
            {!withPanel && <div className="ipl-col--vendor">{t("installed.col.vendor")}</div>}
            <div>{t("installed.col.status")}</div>
            <div />
          </div>

          {visible.map((p) => {
            const k = kindOf(p);
            const on = p.status === "enabled";
            const isActive = active?.id === p.id;
            const checked = selected.includes(p.id);
            const settings = k === "enabled" ? contributions(p.id).pages[0] : undefined;
            return (
              <div
                key={p.id}
                className={`ipl-row${withPanel ? " no-vendor" : ""}${isActive ? " is-active" : ""}${checked ? " is-checked" : ""}`}
                onClick={() => open(p.id)}
              >
                <input
                  type="checkbox"
                  className="ipl-check"
                  checked={checked}
                  onClick={stop}
                  onChange={() => { setBulkConfirm(false); setSelected((s) => checked ? s.filter((id) => id !== p.id) : [...s, p.id]); }}
                  aria-label={t("installed.select", { name: p.name })}
                />
                <div className="ipl-plugin">
                  <span className={`ipl-ic${k === "failed" ? " is-bad" : ""}${on ? "" : " is-off"}`}>
                    <FontAwesomeIcon icon={k === "failed" ? faTriangleExclamation : faPuzzlePiece} />
                  </span>
                  <div className="ipl-plugin__id">
                    <div className="ipl-plugin__line">
                      <button type="button" className="ipl-plugin__name" onClick={(e) => { stop(e); open(p.id); }}>{p.name}</button>
                      <span className="ipl-plugin__ver">v{p.installedVersion}</span>
                    </div>
                    <div className="ipl-plugin__meta">{summary(p)}</div>
                  </div>
                </div>
                {!withPanel && <div className="ipl-col--vendor ipl-vendor">{p.vendor}</div>}
                <div className="ipl-state" onClick={stop}>
                  <Toggle
                    on={on}
                    onToggle={() => setOn([p.id], !on)}
                    disabled={busy.has(p.id)}
                    label={t("installed.toggleLabel", { name: p.name })}
                  />
                  <span className={`ipl-state__label is-${k}`}>{t(`installed.status.${k}`)}</span>
                </div>
                <div className="ipl-actions" onClick={stop}>
                  {settings && (
                    <button type="button" className="ipl-icon-btn" title={t("installed.openSettings")} aria-label={t("installed.openSettings")} onClick={() => navigate(settings.path)}>
                      <FontAwesomeIcon icon={faSliders} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="ipl-icon-btn"
                    title={t("installed.more")}
                    aria-label={t("installed.more")}
                    aria-expanded={menuId === p.id}
                    onClick={(e) => { stop(e); setMenuId((m) => (m === p.id ? null : p.id)); }}
                  >
                    <FontAwesomeIcon icon={faEllipsis} />
                  </button>
                  {menuId === p.id && (
                    <div className="ipl-menu" role="menu" onClick={stop}>
                      <button type="button" role="menuitem" onClick={() => open(p.id)}>
                        <FontAwesomeIcon icon={faRectangleList} /> {t("installed.menu.details")}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => { void navigator.clipboard?.writeText(p.id); setMenuId(null); toast.info(t("installed.copied")); }}
                      >
                        <FontAwesomeIcon icon={faCopy} /> {t("installed.menu.copy")}
                      </button>
                      <div className="ipl-menu__sep" />
                      <button type="button" role="menuitem" className="is-danger" onClick={() => { open(p.id); setConfirmId(p.id); }}>
                        <FontAwesomeIcon icon={faTrashCan} /> {t("installed.removeEllipsis")}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {visible.length === 0 && (
            <div className="ipl-empty">
              <div className="ipl-empty__title">{t("installed.noMatchTitle")}</div>
              <div className="ipl-empty__hint">{t("installed.noMatchHint")}</div>
              <button type="button" className="ipl-mini" onClick={() => { setQuery(""); setFilter("all"); }}>{t("installed.clearFilters")}</button>
            </div>
          )}
          <div className="ipl-foot">{t("installed.footer", { shown: visible.length, total: plugins.length })}</div>
        </section>

        {active && (
          <>
            {!docked && <div className="ipl-scrim" onClick={() => setActiveId(null)} />}
            <PluginPanel
              plugin={active}
              docked={docked}
              contribution={contributions(active.id)}
              busy={busy.has(active.id)}
              confirming={confirmId === active.id}
              removeData={removeData}
              onRemoveData={setRemoveData}
              onClose={() => { setActiveId(null); setConfirmId(null); }}
              onToggle={() => setOn([active.id], active.status !== "enabled")}
              onAskRemove={() => setConfirmId(active.id)}
              onCancelRemove={() => { setConfirmId(null); setRemoveData(false); }}
              onRemove={() => remove([active.id], removeData)}
              onOpenSettings={(path) => navigate(path)}
            />
          </>
        )}
      </div>
    </div>
  );
}

function PluginPanel({
  plugin: p, docked, contribution: c, busy, confirming, removeData,
  onRemoveData, onClose, onToggle, onAskRemove, onCancelRemove, onRemove, onOpenSettings,
}: {
  plugin: InstalledPlugin;
  docked: boolean;
  contribution: Contribution;
  busy: boolean;
  confirming: boolean;
  removeData: boolean;
  onRemoveData: (v: boolean) => void;
  onClose: () => void;
  onToggle: () => void;
  onAskRemove: () => void;
  onCancelRemove: () => void;
  onRemove: () => void;
  onOpenSettings: (path: string) => void;
}) {
  const { t } = useTranslation("acp");
  const k = kindOf(p);
  const on = p.status === "enabled";
  const live = k === "enabled";
  const perms = p.manifest?.permissions?.length ?? 0;
  const settings = live ? c.pages[0] : undefined;

  const adds: { label: string; items: string[] }[] = [];
  if (live && c.pages.length) adds.push({ label: t("installed.adds.pages"), items: c.pages.map((pg) => pg.label) });
  if (live && c.blocks.length) adds.push({ label: t("installed.adds.blocks"), items: c.blocks });
  if (perms) adds.push({ label: t("installed.adds.permissions"), items: [t("installed.adds.permissionKeys", { count: perms })] });
  if (live && c.also.length) adds.push({ label: t("installed.adds.also"), items: c.also });

  const details: { k: string; v: ReactNode; mono?: boolean }[] = [
    { k: t("installed.details.id"), v: p.id, mono: true },
    { k: t("installed.details.origin"), v: <TrustBadge tier={p.signatureTier} recorded={p.contentDigest !== null} /> },
    { k: t("installed.details.licence"), v: p.licenseRequired ? t("installed.details.licenceRequired") : t("installed.details.free") },
    ...(p.manifest?.tablePrefix ? [{ k: t("installed.details.prefix"), v: p.manifest.tablePrefix, mono: true }] : []),
    ...(p.manifest?.migrations?.length ? [{ k: t("installed.details.migrations"), v: String(p.manifest.migrations.length) }] : []),
    { k: t("installed.details.installed"), v: siteTime.date(p.installedAt) },
  ];

  return (
    <aside className={`ipl-panel${docked ? " is-docked" : " is-sheet"}`} aria-label={p.name}>
      <div className="ipl-panel__head">
        <span className={`ipl-ic ipl-ic--lg${k === "failed" ? " is-bad" : ""}`}>
          <FontAwesomeIcon icon={k === "failed" ? faTriangleExclamation : faPuzzlePiece} />
        </span>
        <div className="ipl-panel__titles">
          <h2>{p.name}</h2>
          <div className="ipl-panel__by">{t("installed.byline", { version: p.installedVersion, vendor: p.vendor })}</div>
        </div>
        <button type="button" className="ipl-icon-btn" onClick={onClose} aria-label={t("installed.close")}>
          <FontAwesomeIcon icon={faXmark} />
        </button>
      </div>

      <div className={`ipl-statecard is-${k}`}>
        <div className="ipl-statecard__text">
          <div className={`ipl-statecard__label is-${k}`}>{t(`installed.status.${k}`)}</div>
          <div className="ipl-statecard__desc">{t(`installed.stateDesc.${k}`)}</div>
        </div>
        <Toggle on={on} onToggle={onToggle} disabled={busy} label={t("installed.toggleLabel", { name: p.name })} />
      </div>
      {k === "failed" && p.loadError && <div className="ipl-error">{p.loadError.message}</div>}

      {(settings || p.storeUrl) && (
        <div className="ipl-panel__links">
          {settings && (
            <button type="button" className="btn-primary btn-sm" onClick={() => onOpenSettings(settings.path)}>
              {t("installed.openSettings")} <FontAwesomeIcon icon={faArrowRight} />
            </button>
          )}
          {p.storeUrl && (
            <a className="btn-ghost btn-sm" href={p.storeUrl} target="_blank" rel="noopener noreferrer">
              {t("installed.marketplacePage")} <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
            </a>
          )}
        </div>
      )}

      <div className="ipl-panel__sec">
        <div className="ipl-panel__sechead">
          <span>{t("installed.adds.title")}</span>
          {!live && <span className="ipl-panel__note">{t("installed.adds.inactive")}</span>}
        </div>
        {adds.map((g) => (
          <div key={g.label} className={`ipl-adds${live ? "" : " is-dim"}`}>
            <div className="ipl-adds__label">{g.label}</div>
            <div className="ipl-adds__items">{g.items.map((it) => <span key={it} className="ipl-chip">{it}</span>)}</div>
          </div>
        ))}
        {!live && <p className="ipl-panel__hint">{t("installed.adds.whenOn")}</p>}
      </div>

      <div className="ipl-panel__sec">
        <div className="ipl-panel__sechead"><span>{t("installed.details.title")}</span></div>
        {details.map((d) => (
          <div key={d.k} className="ipl-dl">
            <span className="ipl-dl__k">{d.k}</span>
            <span className={`ipl-dl__v${d.mono ? " is-mono" : ""}`}>{d.v}</span>
          </div>
        ))}
      </div>

      <div className="ipl-panel__danger">
        {!confirming ? (
          <div className="ipl-panel__removerow">
            <span>{t("installed.removeHint")}</span>
            <button type="button" className="ipl-mini ipl-mini--danger" onClick={onAskRemove} disabled={busy}>{t("installed.removePlugin")}</button>
          </div>
        ) : (
          <div className="ipl-removebox" role="alert">
            <div className="ipl-removebox__title">{t("installed.removeTitle", { name: p.name })}</div>
            <label className="ipl-removebox__data">
              <input type="checkbox" checked={removeData} onChange={(e) => onRemoveData(e.target.checked)} />
              <span>{t("installed.removeAlsoData")}</span>
            </label>
            <div className="ipl-removebox__btns">
              <button type="button" className="ipl-mini" onClick={onCancelRemove}>{t("installed.cancel")}</button>
              <button type="button" className="ipl-mini ipl-mini--solid-danger" onClick={onRemove} disabled={busy}>{t("installed.remove")}</button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

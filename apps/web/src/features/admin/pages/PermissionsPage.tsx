import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useBlocker, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { faTableCells, faTableColumns } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../../components/Icon";
import { api } from "../../../lib/api";
import { apiErrorMessage } from "../../../lib/swal";
import { toast } from "../../../lib/toast";
import { openDialog } from "../../../lib/dialog";
import { enrichPerm, groupByDomain, type Permission } from "../../../lib/permissions";
import { isSensitive, keysOf, type Group } from "./groups/groupModel";
import {
  applyEdits, deltaOf, draftKeys, editsToMatch, pruneEdits, summarize, type Edits,
} from "./permissions/permissionsModel";
import { SplitView } from "./permissions/SplitView";
import { MatrixView } from "./permissions/MatrixView";
import "./groups/Groups.scss";
import "./permissions/Permissions.scss";

/** Everything the two views read and the one way they change the draft. */
export interface PermissionsCtx {
  groups: Group[];
  domains: [string, Permission[]][];
  total: number;
  saved: (groupId: string) => Set<string>;
  draft: (groupId: string) => Set<string>;
  edits: Edits;
  /** Grant or revoke `keys`; asks first when a grant adds a sensitive key. */
  request: (groupId: string, keys: string[], on: boolean) => void;
  copyFrom: (groupId: string, sourceId: string) => void;
}

export function PermissionsPage() {
  const { t, i18n } = useTranslation("acp");
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [edits, setEdits] = useState<Edits>({});
  const [saving, setSaving] = useState(false);

  const { data: groups = [], isLoading: groupsLoading } = useQuery<Group[]>({
    queryKey: ["acp-groups-list"],
    queryFn: () => api.get("/admin/groups"),
  });
  const { data: rawPerms = [], isLoading: permsLoading } = useQuery<Permission[]>({
    queryKey: ["acp-permissions-all"],
    queryFn: () => api.get("/admin/permissions"),
  });

  // Names are translated, so a language switch recomputes them.
  const perms = useMemo(() => rawPerms.map(enrichPerm), [rawPerms, i18n.language]);
  const domains = useMemo(() => groupByDomain(rawPerms), [rawPerms, i18n.language]);

  const savedMap = useMemo(() => new Map(groups.map((g) => [g.id, new Set(keysOf(g))])), [groups]);
  const saved = useCallback((id: string) => savedMap.get(id) ?? new Set<string>(), [savedMap]);
  const draft = useCallback((id: string) => draftKeys(saved(id), edits[id]), [saved, edits]);

  // A refetch moves the baseline under the edits; drop the ones it made moot.
  useEffect(() => {
    setEdits((e) => {
      const next = pruneEdits(e, (id) => savedMap.get(id));
      return JSON.stringify(next) === JSON.stringify(e) ? e : next;
    });
  }, [savedMap]);

  const view = params.get("view") === "matrix" ? "matrix" : "split";
  const selected = groups.find((g) => g.key === params.get("group")) ?? groups[0];
  const setUrl = (next: { view?: "split" | "matrix"; group?: string }) => {
    setParams((p) => {
      const n = new URLSearchParams(p);
      const v = next.view ?? view;
      if (v === "matrix") n.set("view", "matrix"); else n.delete("view");
      if (next.group) n.set("group", next.group);
      return n;
    }, { replace: true });
  };

  const labelOf = (key: string) => perms.find((p) => p.key === key)?.label ?? key;

  const request = (groupId: string, keys: string[], on: boolean) => {
    const g = groups.find((x) => x.id === groupId);
    if (!g) return;
    const apply = () => setEdits((e) => applyEdits(e, groupId, saved(groupId), keys, on));
    if (!on) return apply();
    // Only a grant that would ADD power asks: a key already saved, or already in
    // the draft, has been confirmed once.
    const current = draft(groupId);
    const risky = keys.filter((k) => isSensitive(k) && !current.has(k) && !saved(groupId).has(k));
    if (!risky.length) return apply();
    void confirmSensitive(g, risky).then((ok) => { if (ok) apply(); });
  };

  const copyFrom = (groupId: string, sourceId: string) => {
    const g = groups.find((x) => x.id === groupId);
    if (!g) return;
    const target = draft(sourceId);
    const apply = () => setEdits((e) => editsToMatch(e, groupId, saved(groupId), target));
    const current = draft(groupId);
    const risky = [...target].filter((k) => isSensitive(k) && !current.has(k) && !saved(groupId).has(k));
    if (!risky.length) return apply();
    void confirmSensitive(g, risky).then((ok) => { if (ok) apply(); });
  };

  const confirmSensitive = (g: Group, keys: string[]) => openDialog({
    kind: "confirm",
    icon: "warning",
    danger: true,
    title: keys.length === 1
      ? t("permissions.confirmOne", { label: labelOf(keys[0]!), group: g.name })
      : t("permissions.confirmMany", { count: keys.length, group: g.name }),
    bodyNode: (
      <div className="pm-confirm">
        <p>{t("permissions.confirmBody", { count: g._count.users })}</p>
        <div className="pm-confirm__keys">{keys.map((k) => <code key={k}>{k}</code>)}</div>
      </div>
    ),
    confirmText: keys.length === 1 ? t("permissions.confirmCtaOne") : t("permissions.confirmCtaMany", { count: keys.length }),
    cancelText: t("permissions.cancel"),
  });

  const summary = summarize(edits, saved);
  const dirtyCount = summary.grants + summary.revokes;
  const dirty = dirtyCount > 0;

  const save = async () => {
    if (saving || !dirty) return;
    setSaving(true);
    let failed = false;
    for (const id of summary.groupIds) {
      const delta = deltaOf(saved(id), edits[id]);
      try {
        const updated = await api.patch<Group>(`/admin/groups/${id}/permissions`, delta);
        // Swap the new row in before dropping the edits, so the page never
        // shows the old baseline for a frame between the two.
        qc.setQueryData<Group[]>(["acp-groups-list"], (list) =>
          list?.map((g) => (g.id === id ? { ...g, ...updated, _count: { ...g._count, ...updated._count } } : g)));
        setEdits((e) => { const n = { ...e }; delete n[id]; return n; });
      } catch (err) {
        failed = true;
        toast.error(apiErrorMessage(err));
      }
    }
    void qc.invalidateQueries({ queryKey: ["acp-groups-list"] });
    setSaving(false);
    if (!failed) toast.success(t("permissions.toastSaved"));
  };
  const discard = () => setEdits({});

  // Ctrl/Cmd+S saves wherever focus is; `/` jumps to the search box.
  const saveRef = useRef(save);
  saveRef.current = save;
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      const typing = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement | null)?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void saveRef.current(); }
      else if (e.key === "/" && !typing) { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Unsaved edits survive neither a reload nor leaving the page — ask first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    void openDialog({
      kind: "confirm", icon: "warning", danger: true,
      title: t("permissions.leaveTitle"),
      body: t("permissions.leaveBody", { count: dirtyCount }),
      confirmText: t("permissions.leaveConfirm"),
      cancelText: t("permissions.stay"),
    }).then((ok) => (ok ? blocker.proceed() : blocker.reset()));
  }, [blocker, dirtyCount, t]);

  if (groupsLoading || permsLoading) {
    return <div className="pm-page"><div className="gp-empty">{t("permissions.loading")}</div></div>;
  }

  const ctx: PermissionsCtx = { groups, domains, total: perms.length, saved, draft, edits, request, copyFrom };
  const dirtyNames = groups.filter((g) => summary.groupIds.includes(g.id)).map((g) => g.name).join(", ");

  return (
    <div className="pm-page">
      <div className="pg-head pm-head">
        <div>
          <p className="pg-eyebrow">{t("nav.members")}</p>
          <h1 className="pg-title">{t("nav.permissions")}</h1>
        </div>
        <div className="pm-head__actions">
          <div className="acp-seg acp-seg--auto pm-viewswitch" role="tablist">
            <button type="button" role="tab" aria-selected={view === "split"} className={view === "split" ? "is-on" : ""} onClick={() => setUrl({ view: "split" })}>
              <FontAwesomeIcon icon={faTableColumns} className="pm-ic" /> {t("permissions.viewSplit")}
            </button>
            <button type="button" role="tab" aria-selected={view === "matrix"} className={view === "matrix" ? "is-on" : ""} onClick={() => setUrl({ view: "matrix" })}>
              <FontAwesomeIcon icon={faTableCells} className="pm-ic" /> {t("permissions.viewMatrix")}
            </button>
          </div>
          <Link to="/admin/groups" className="btn-ghost btn-sm">{t("permissions.manageGroups")}</Link>
          <div className={`pm-status${saving ? " is-saving" : dirty ? " is-dirty" : ""}`} aria-live="polite">
            <span className="pm-status__dot" />
            {saving ? t("permissions.saving") : dirty ? t("permissions.unsaved", { count: dirtyCount }) : t("permissions.allSaved")}
          </div>
        </div>
      </div>

      {perms.length === 0 ? (
        <div className="gp-card gp-empty">{t("permissions.empty")}</div>
      ) : view === "split" && selected ? (
        <SplitView ctx={ctx} selected={selected} onSelect={(g) => setUrl({ group: g.key })} searchRef={searchRef} />
      ) : (
        <MatrixView ctx={ctx} onOpen={(g) => setUrl({ view: "split", group: g.key })} searchRef={searchRef} />
      )}

      {(dirty || saving) && (
        <div className="pm-savebar" role="region" aria-label={t("permissions.unsaved", { count: dirtyCount })}>
          <span className="pm-savebar__dot" />
          <div className="pm-savebar__text">
            <strong>{t("permissions.unsaved", { count: dirtyCount })}</strong>
            <span>
              {[
                summary.grants ? t("permissions.toGrant", { count: summary.grants }) : null,
                summary.revokes ? t("permissions.toRevoke", { count: summary.revokes }) : null,
              ].filter(Boolean).join(" · ")} {dirtyNames && t("permissions.inGroups", { groups: dirtyNames })}
            </span>
          </div>
          <kbd className="pm-kbd pm-kbd--dark">Ctrl S</kbd>
          <button type="button" className="pm-savebar__discard" onClick={discard} disabled={saving}>{t("permissions.discard")}</button>
          <button type="button" className="btn-primary btn-sm" onClick={() => void save()} disabled={saving}>
            {saving ? t("permissions.saving") : t("permissions.save")}
          </button>
        </div>
      )}
    </div>
  );
}

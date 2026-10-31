import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "../../../components/Icon";
import {
  faPlus, faGripVertical, faPencil, faTrash, faArrowTurnUp,
  faSave, faExternalLinkAlt,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { swalToast, apiErrorMessage, swalConfirm } from "../../../lib/swal";
import { Toggle } from "../../../components/Toggle";
import { Button } from "../../../components/AcpControls";

interface NavItem {
  id: string;
  label: string;
  url: string;
  position: number;
  isActive: boolean;
  isSystem: boolean;
  openInNewTab: boolean;
  visibility: string;
  /** Shown in this link's dropdown (one level). */
  parentId?: string | null;
  placement?: string;
}

type NavItemInput = { label: string; url: string; openInNewTab: boolean; visibility: string; parentId: string | null };

function EditModal({
  item,
  parents,
  hasChildren,
  onClose,
  onSave,
}: {
  item?: NavItem;
  /** Links in the bar this one may sit under. */
  parents: NavItem[];
  /** It has links under it, so it stays in the bar. */
  hasChildren: boolean;
  onClose: () => void;
  onSave: (data: NavItemInput) => void;
}) {
  const { t } = useTranslation("acp");
  const [label,      setLabel]      = useState(item?.label       ?? "");
  const [url,        setUrl]        = useState(item?.url         ?? "");
  const [openNew,    setOpenNew]    = useState(item?.openInNewTab ?? false);
  const [visibility, setVisibility] = useState(item?.visibility  ?? "public");
  const [parentId,   setParentId]   = useState<string | null>(item?.parentId ?? null);

  return (
    <div className="acp-modal-overlay" onClick={onClose}>
      <div className="acp-modal" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginBottom: "1.5rem", fontSize: "1.1rem" }}>
          {item ? t("navigation.editLink") : t("navigation.addLink")}
        </h2>

        <div className="acp-form-field">
          <label className="acp-label">{t("navigation.fieldLabel")}</label>
          <input className="acp-input" value={label} onChange={e => setLabel(e.target.value)} placeholder={t("navigation.labelPlaceholder")} autoFocus />
        </div>

        <div className="acp-form-field">
          <label className="acp-label">{t("navigation.fieldUrl")}</label>
          <input className="acp-input" value={url} onChange={e => setUrl(e.target.value)} placeholder={t("navigation.urlPlaceholder")} />
        </div>

        <div className="acp-form-field">
          <label className="acp-label">{t("navigation.fieldVisibility")}</label>
          <select className="acp-select" value={visibility} onChange={e => setVisibility(e.target.value)}>
            <option value="public">{t("navigation.visOptPublic")}</option>
            <option value="members">{t("navigation.visOptMembers")}</option>
            <option value="groups">{t("navigation.visOptGroups")}</option>
          </select>
        </div>

        <div className="acp-form-field">
          <label className="acp-label">{t("navigation.fieldParent")}</label>
          <select className="acp-select" value={parentId ?? ""} disabled={hasChildren}
            onChange={e => setParentId(e.target.value || null)}>
            <option value="">{t("navigation.parentNone")}</option>
            {parents.filter((p) => p.id !== item?.id).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          {hasChildren && <p className="acp-hint">{t("navigation.parentLocked")}</p>}
        </div>

        <label className="acp-checkbox-row" style={{ marginBottom: "1.25rem" }}>
          <input type="checkbox" checked={openNew} onChange={e => setOpenNew(e.target.checked)} />
          <span>{t("navigation.openNewTab")}</span>
        </label>

        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onClose}>{t("navigation.cancel")}</Button>
          <Button
           
            disabled={!label.trim() || !url.trim()}
            onClick={() => onSave({ label, url, openInNewTab: openNew, visibility, parentId })}
          >
            <FontAwesomeIcon icon={faSave} style={{ marginRight: 5 }} />
            {item ? t("navigation.save") : t("navigation.addLink")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function NavigationPage() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();

  // useRef for drag source — always synchronously current, no stale-closure risk
  const dragSrcRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [editItem,   setEditItem]   = useState<NavItem | null | undefined>(undefined);

  const { data: items = [], isLoading } = useQuery<NavItem[]>({
    queryKey: ["acp-nav-items"],
    queryFn: () => api.get("/admin/nav-items"),
  });

  /** The bar's links in order, each followed by the links in its dropdown. */
  const sorted = useMemo(() => {
    const byPos = [...items].sort((a, b) => a.position - b.position);
    const top = byPos.filter((i) => !i.parentId || !items.some((p) => p.id === i.parentId));
    return top.flatMap((p) => [p, ...byPos.filter((c) => c.parentId === p.id)]);
  }, [items]);
  const parents = useMemo(() => sorted.filter((i) => !i.parentId && (i.placement ?? "navbar") === "navbar"), [sorted]);

  // ── Mutations ──────────────────────────────────────────────────────────────

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["acp-nav-items"] });
    qc.invalidateQueries({ queryKey: ["pub-nav-items"] }); // sync public navbar
  }

  const createMutation = useMutation({
    mutationFn: (data: NavItemInput) =>
      api.post("/admin/nav-items", data),
    onSuccess: () => {
      invalidateAll();
      swalToast(t("navigation.toastAdded"), "success");
      setEditItem(undefined);
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<NavItem> }) =>
      api.patch(`/admin/nav-items/${id}`, data),
    onSuccess: () => {
      invalidateAll();
      swalToast(t("navigation.toastUpdated"), "success");
      setEditItem(undefined);
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const reorderMutation = useMutation({
    mutationFn: (payload: Array<{ id: string; position: number }>) =>
      api.patch("/admin/nav-items/reorder", { items: payload }),

    // Apply optimistic reorder immediately — UI feels instant
    onMutate: async (payload) => {
      await qc.cancelQueries({ queryKey: ["acp-nav-items"] });
      const previous = qc.getQueryData<NavItem[]>(["acp-nav-items"]);
      if (previous) {
        const posMap = new Map(payload.map(p => [p.id, p.position]));
        const optimistic = previous
          .map(item => ({ ...item, position: posMap.get(item.id) ?? item.position }))
          .sort((a, b) => a.position - b.position);
        qc.setQueryData(["acp-nav-items"], optimistic);
      }
      return { previous };
    },
    onError: (_e, _payload, ctx) => {
      if (ctx?.previous) qc.setQueryData(["acp-nav-items"], ctx.previous);
      swalToast(t("navigation.toastReorderFailed"));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["acp-nav-items"] });
      qc.invalidateQueries({ queryKey: ["pub-nav-items"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/nav-items/${id}`),
    onSuccess: () => {
      invalidateAll();
      swalToast(t("navigation.toastRemoved"), "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  // ── Drag handlers ──────────────────────────────────────────────────────────

  function onDragStart(e: React.DragEvent, id: string) {
    // setData is required for Firefox — without it the drag is silently cancelled
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
    dragSrcRef.current = id;    // ref update is synchronous — no stale closure
  }

  function onDragOver(e: React.DragEvent, id: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (id !== dragSrcRef.current) setDragOverId(id);
  }

  function onDragLeave() {
    setDragOverId(null);
  }

  function onDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    const src = dragSrcRef.current;   // always current, never stale
    if (!src || src === targetId) { resetDrag(); return; }

    const from = sorted.findIndex(n => n.id === src);
    const to   = sorted.findIndex(n => n.id === targetId);
    if (from === -1 || to === -1) { resetDrag(); return; }

    const reordered = [...sorted];
    const [moved] = reordered.splice(from, 1);
    if (!moved) { resetDrag(); return; }
    reordered.splice(to, 0, moved);

    reorderMutation.mutate(reordered.map((n, i) => ({ id: n.id, position: i + 1 })));
    resetDrag();
  }

  function onDragEnd() {
    resetDrag();
  }

  function resetDrag() {
    dragSrcRef.current = null;
    setDragOverId(null);
  }

  async function handleDelete(item: NavItem) {
    const result = await swalConfirm(
      t("navigation.removeTitle"),
      t("navigation.removeText", { label: item.label }),
      t("navigation.remove"), t("navigation.cancel"),
    );
    if (result) deleteMutation.mutate(item.id);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">{t("nav.appearance")}</div>
          <h1 className="acp-page-title">{t("nav.navigation")}</h1>
        </div>
        <Button onClick={() => setEditItem(null)}>
          <FontAwesomeIcon icon={faPlus} style={{ marginRight: 5 }} /> {t("navigation.addLink")}
        </Button>
      </div>

      <div style={{
        background: "var(--c-accent-soft)", border: "1px solid var(--c-accent-glow)",
        borderRadius: "var(--radius-sm)", padding: "10px 16px",
        marginBottom: 20, fontSize: "var(--fs-sm)", color: "var(--c-accent)",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <FontAwesomeIcon icon={faGripVertical} />
        {t("navigation.reorderHint")}
      </div>

      {isLoading ? (
        <div className="acp-card acp-empty">{t("navigation.loading")}</div>
      ) : sorted.length === 0 ? (
        <div className="acp-card acp-empty">{t("navigation.empty")}</div>
      ) : (
        <div className="acp-card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: "36px 1fr 200px 90px 70px 90px",
            padding: "10px 18px",
            borderBottom: "1px solid var(--c-border)",
          }}>
            {[["h_", ""], ["h_label", t("navigation.colLabel")], ["h_url", t("navigation.colUrl")], ["h_vis", t("navigation.colVisibility")], ["h_active", t("navigation.colActive")], ["h_actions", t("navigation.colActions")]].map(([k, h]) => (
              <div key={k} style={{ fontSize: "var(--fs-2xs)", fontWeight: 700, color: "var(--c-fg-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>{h}</div>
            ))}
          </div>

          {sorted.map((item, i) => {
            const isOver = dragOverId === item.id;
            return (
              <div
                key={item.id}
                draggable
                onDragStart={(e) => onDragStart(e, item.id)}
                onDragOver={(e) => onDragOver(e, item.id)}
                onDragLeave={onDragLeave}
                onDrop={(e) => onDrop(e, item.id)}
                onDragEnd={onDragEnd}
                style={{
                  display: "grid",
                  gridTemplateColumns: "36px 1fr 200px 90px 70px 90px",
                  alignItems: "center",
                  padding: "13px 18px",
                  borderBottom: i < sorted.length - 1 ? "1px solid var(--c-border)" : "none",
                  background: isOver ? "var(--c-accent-soft)" : "transparent",
                  borderTop: isOver ? "2px solid var(--c-accent)" : "2px solid transparent",
                  transition: "background 0.1s",
                  userSelect: "none",
                }}
              >
                {/* Grip handle */}
                <div
                  style={{ cursor: "grab", color: "var(--c-fg-muted)", fontSize: "var(--fs-md)", display: "flex", alignItems: "center" }}
                  title={t("navigation.dragTitle")}
                >
                  <FontAwesomeIcon icon={faGripVertical} />
                </div>

                {/* Label (a dropdown link sits indented under its parent) */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: item.parentId ? 22 : 0 }}>
                  {item.parentId && <FontAwesomeIcon icon={faArrowTurnUp} rotation={90} style={{ color: "var(--c-fg-subtle)" }} aria-hidden />}
                  <span style={{ fontSize: "var(--fs-sm)", fontWeight: 700, color: "var(--c-fg)" }}>{item.label}</span>
                  {item.isSystem && (
                    <span className="acp-badge acp-badge--muted" style={{ marginTop: 0 }}>{t("navigation.core")}</span>
                  )}
                  {item.openInNewTab && (
                    <FontAwesomeIcon icon={faExternalLinkAlt} style={{ fontSize: "var(--fs-2xs)", color: "var(--c-fg-muted)" }} />
                  )}
                </div>

                {/* URL */}
                <div style={{ fontSize: "var(--fs-xs)", color: "var(--c-fg-muted)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.url}
                </div>

                {/* Visibility */}
                <div>
                  <span
                    className={`acp-badge ${item.visibility === "public" ? "acp-badge--success" : "acp-badge--neutral"}`}
                    style={{ marginTop: 0 }}
                  >
                    {t(`navigation.visibility.${item.visibility}`, { defaultValue: item.visibility })}
                  </span>
                </div>

                {/* Active toggle */}
                <div>
                  <Toggle
                    on={item.isActive}
                    onToggle={() => updateMutation.mutate({ id: item.id, data: { isActive: !item.isActive } })}
                    label={item.isActive ? t("navigation.deactivate") : t("navigation.activate")}
                  />
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: "0.4rem" }}>
                  <Button variant="ghost" onClick={() => setEditItem(item)}>
                    <FontAwesomeIcon icon={faPencil} />
                  </Button>
                  {item.isSystem ? (
                    <Button variant="ghost" disabled title={t("navigation.coreNoDelete")}>
                      <FontAwesomeIcon icon={faTrash} />
                    </Button>
                  ) : (
                    <Button variant="danger" onClick={() => handleDelete(item)}>
                      <FontAwesomeIcon icon={faTrash} />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editItem !== undefined && (
        <EditModal
          item={editItem ?? undefined}
          parents={parents}
          hasChildren={!!editItem && items.some((i) => i.parentId === editItem.id)}
          onClose={() => setEditItem(undefined)}
          onSave={(data) => {
            if (editItem) {
              updateMutation.mutate({ id: editItem.id, data });
            } else {
              createMutation.mutate(data);
            }
          }}
        />
      )}
    </div>
  );
}

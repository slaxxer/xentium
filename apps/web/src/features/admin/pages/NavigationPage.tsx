import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlus, faGripVertical, faPencil, faTrash,
  faToggleOn, faToggleOff, faSave, faExternalLinkAlt,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { swalToast, apiErrorMessage, swalConfirm } from "../../../lib/swal";

interface NavItem {
  id: string;
  label: string;
  url: string;
  position: number;
  isActive: boolean;
  isSystem: boolean;
  openInNewTab: boolean;
  visibility: string;
}

function EditModal({
  item,
  onClose,
  onSave,
}: {
  item?: NavItem;
  onClose: () => void;
  onSave: (data: { label: string; url: string; openInNewTab: boolean; visibility: string }) => void;
}) {
  const [label,      setLabel]      = useState(item?.label       ?? "");
  const [url,        setUrl]        = useState(item?.url         ?? "");
  const [openNew,    setOpenNew]    = useState(item?.openInNewTab ?? false);
  const [visibility, setVisibility] = useState(item?.visibility  ?? "public");

  return (
    <div className="acp-modal-overlay" onClick={onClose}>
      <div className="acp-modal" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginBottom: "1.5rem", fontSize: "1.1rem" }}>
          {item ? "Edit Nav Link" : "Add Nav Link"}
        </h2>

        <div className="acp-form-field">
          <label className="acp-label">Label</label>
          <input className="acp-input" value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Forum" autoFocus />
        </div>

        <div className="acp-form-field">
          <label className="acp-label">URL</label>
          <input className="acp-input" value={url} onChange={e => setUrl(e.target.value)} placeholder="/forum or https://..." />
        </div>

        <div className="acp-form-field">
          <label className="acp-label">Visibility</label>
          <select className="acp-select" value={visibility} onChange={e => setVisibility(e.target.value)}>
            <option value="public">Public — everyone</option>
            <option value="members">Members only</option>
            <option value="groups">Specific groups</option>
          </select>
        </div>

        <label className="acp-checkbox-row" style={{ marginBottom: "1.25rem" }}>
          <input type="checkbox" checked={openNew} onChange={e => setOpenNew(e.target.checked)} />
          <span>Open in new tab</span>
        </label>

        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={!label.trim() || !url.trim()}
            onClick={() => onSave({ label, url, openInNewTab: openNew, visibility })}
          >
            <FontAwesomeIcon icon={faSave} style={{ marginRight: 5 }} />
            {item ? "Save" : "Add Link"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function NavigationPage() {
  const qc = useQueryClient();

  // useRef for drag source — always synchronously current, no stale-closure risk
  const dragSrcRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [editItem,   setEditItem]   = useState<NavItem | null | undefined>(undefined);

  const { data: items = [], isLoading } = useQuery<NavItem[]>({
    queryKey: ["acp-nav-items"],
    queryFn: () => api.get("/admin/nav-items"),
  });

  const sorted = useMemo(
    () => [...items].sort((a, b) => a.position - b.position),
    [items],
  );

  // ── Mutations ──────────────────────────────────────────────────────────────

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["acp-nav-items"] });
    qc.invalidateQueries({ queryKey: ["pub-nav-items"] }); // sync public navbar
  }

  const createMutation = useMutation({
    mutationFn: (data: { label: string; url: string; openInNewTab: boolean; visibility: string }) =>
      api.post("/admin/nav-items", data),
    onSuccess: () => {
      invalidateAll();
      swalToast("Link added!", "success");
      setEditItem(undefined);
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<NavItem> }) =>
      api.patch(`/admin/nav-items/${id}`, data),
    onSuccess: () => {
      invalidateAll();
      swalToast("Link updated!", "success");
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
      swalToast("Reorder failed — reverted.");
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
      swalToast("Link removed!", "success");
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
      "Remove link?",
      `"${item.label}" will be removed from the navigation.`,
      "Remove", "Cancel",
    );
    if (result) deleteMutation.mutate(item.id);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">Appearance</div>
          <h1 className="acp-page-title">Navigation</h1>
        </div>
        <button type="button" className="btn-primary btn-sm" onClick={() => setEditItem(null)}>
          <FontAwesomeIcon icon={faPlus} style={{ marginRight: 5 }} /> Add Link
        </button>
      </div>

      <div style={{
        background: "var(--c-accent-soft)", border: "1px solid var(--c-accent-glow)",
        borderRadius: "var(--radius-sm)", padding: "10px 16px",
        marginBottom: 20, fontSize: 13, color: "var(--c-accent)",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <FontAwesomeIcon icon={faGripVertical} />
        Drag the grip handle to reorder navigation links.
      </div>

      {isLoading ? (
        <div className="acp-card acp-empty">Loading…</div>
      ) : sorted.length === 0 ? (
        <div className="acp-card acp-empty">No nav links yet.</div>
      ) : (
        <div className="acp-card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: "36px 1fr 200px 90px 70px 90px",
            padding: "10px 18px",
            borderBottom: "1px solid var(--c-border)",
          }}>
            {["", "Label", "URL", "Visibility", "Active", "Actions"].map(h => (
              <div key={h} style={{ fontSize: 11, fontWeight: 700, color: "var(--c-fg-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>{h}</div>
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
                  style={{ cursor: "grab", color: "var(--c-fg-muted)", fontSize: 14, display: "flex", alignItems: "center" }}
                  title="Drag to reorder"
                >
                  <FontAwesomeIcon icon={faGripVertical} />
                </div>

                {/* Label */}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--c-fg)" }}>{item.label}</span>
                  {item.isSystem && (
                    <span className="acp-badge acp-badge--muted" style={{ marginTop: 0 }}>Core</span>
                  )}
                  {item.openInNewTab && (
                    <FontAwesomeIcon icon={faExternalLinkAlt} style={{ fontSize: 10, color: "var(--c-fg-muted)" }} />
                  )}
                </div>

                {/* URL */}
                <div style={{ fontSize: 12, color: "var(--c-fg-muted)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.url}
                </div>

                {/* Visibility */}
                <div>
                  <span
                    className={`acp-badge ${item.visibility === "public" ? "acp-badge--success" : "acp-badge--neutral"}`}
                    style={{ marginTop: 0 }}
                  >
                    {item.visibility}
                  </span>
                </div>

                {/* Active toggle */}
                <div>
                  <button
                    type="button"
                    onClick={() => updateMutation.mutate({ id: item.id, data: { isActive: !item.isActive } })}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
                    title={item.isActive ? "Deactivate" : "Activate"}
                  >
                    <FontAwesomeIcon
                      icon={item.isActive ? faToggleOn : faToggleOff}
                      style={{ fontSize: 22, color: item.isActive ? "var(--c-accent)" : "var(--c-fg-muted)" }}
                    />
                  </button>
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: "0.4rem" }}>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setEditItem(item)}>
                    <FontAwesomeIcon icon={faPencil} />
                  </button>
                  {item.isSystem ? (
                    <button type="button" className="btn-ghost btn-sm" disabled title="Core links cannot be deleted — deactivate them instead">
                      <FontAwesomeIcon icon={faTrash} />
                    </button>
                  ) : (
                    <button type="button" className="btn-danger btn-sm" onClick={() => handleDelete(item)}>
                      <FontAwesomeIcon icon={faTrash} />
                    </button>
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

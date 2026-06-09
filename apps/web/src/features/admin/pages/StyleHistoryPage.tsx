import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPalette, faRotateLeft } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { swalToast, apiErrorMessage, swalConfirm } from "../../../lib/swal";
import { Username } from "../../../components/Username";

function reloadTokenStyle() {
  fetch("/api/appearance/css")
    .then((r) => (r.ok ? r.text() : ""))
    .then((css) => {
      let el = document.getElementById("nodevo-custom-tokens") as HTMLStyleElement | null;
      if (!el) { el = document.createElement("style"); el.id = "nodevo-custom-tokens"; document.head.appendChild(el); }
      el.textContent = css;
    }).catch(() => {});
}

interface StyleHistoryEntry {
  id: string; label: string; createdAt: string;
  savedBy: { id: string; username: string; badgeColor: string | null };
}

function timeLabel(d: string) {
  return new Date(d).toLocaleString("en-US", {
    month:"short", day:"numeric", year:"numeric",
    hour:"2-digit", minute:"2-digit",
  });
}

export function StyleHistoryPage() {
  const qc = useQueryClient();
  const { data: history = [], isLoading } = useQuery<StyleHistoryEntry[]>({
    queryKey: ["acp-style-history"],
    queryFn: () => api.get("/admin/style-history"),
  });

  const restoreMut = useMutation({
    mutationFn: (id: string) => api.post(`/appearance/history/${id}/restore`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["acp-style-history"] });
      qc.invalidateQueries({ queryKey: ["acp-tokens"] });
      reloadTokenStyle();
      swalToast("Style restored and applied.", "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const handleRestore = async (h: StyleHistoryEntry) => {
    const ok = await swalConfirm(`Restore "${h.label}"?`, "This will overwrite the current style settings.", "Restore");
    if (ok) restoreMut.mutate(h.id);
  };

  return (
    <div>
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">Appearance</div>
          <h1 className="acp-page-title">Style History</h1>
        </div>
      </div>

      {isLoading ? (
        <div className="acp-card acp-empty">Loading…</div>
      ) : history.length === 0 ? (
        <div className="acp-card acp-empty">No saved style snapshots yet.</div>
      ) : (
        <div className="acp-card" style={{ padding:0,overflow:"hidden" }}>
          {history.map((h, i) => (
            <div
              key={h.id}
              style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom: i < history.length - 1 ? "1px solid var(--c-border)" : "none" }}
            >
              <div style={{ display:"flex",alignItems:"center",gap:12 }}>
                <div style={{ width:36,height:36,background:"var(--c-accent-soft)",border:"1px solid var(--c-accent-glow)",borderRadius:"var(--radius-sm)",display:"flex",alignItems:"center",justifyContent:"center",color:"var(--c-accent)",fontSize:14 }}>
                  <FontAwesomeIcon icon={faPalette} />
                </div>
                <div>
                  <div style={{ fontSize:13,fontWeight:700,color:"var(--c-fg)" }}>{h.label}</div>
                  <div style={{ fontSize:12,color:"var(--c-fg-muted)" }}>{timeLabel(h.createdAt)} · by <Username username={h.savedBy.username} badgeColor={h.savedBy.badgeColor} /></div>
                </div>
              </div>
              <div style={{ display:"flex",gap:6 }}>
                <button
                  type="button" className="btn-ghost btn-sm"
                  style={{ color:"var(--c-accent)",borderColor:"var(--c-accent-glow)",background:"var(--c-accent-soft)" }}
                  disabled={restoreMut.isPending}
                  onClick={() => handleRestore(h)}
                >
                  <FontAwesomeIcon icon={faRotateLeft} style={{ marginRight: 4 }} /> Restore
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

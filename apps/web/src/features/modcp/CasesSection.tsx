import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FontAwesomeIcon } from "../../components/Icon";
import { faTriangleExclamation, faBan, faUserCheck, faCheckDouble } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../lib/api";
import { timeAgo } from "../../lib/time";
import { swalToast, apiErrorMessage, swalConfirm } from "../../lib/swal";

// ModCanvas → Cases section. Core surface for §15 review cases — baseline
// patterns (core) and plugin scans both open cases reviewed here, via the
// core /moderation/cases endpoints.

interface Case {
  id: string; type: string; severity: string; status: string;
  signals: string[]; linkedUserIds: string[];
  linkedUsers: { id: string; username: string; badgeColor: string | null }[];
  ipAddresses: string[]; createdAt: string;
}
interface Paged<T> { data: T[]; meta: { total: number } }

function Tag({ children, crit }: { children: React.ReactNode; crit?: boolean }) {
  return <span className={`mc-tag${crit ? " mc-tag--crit" : ""}`}>{children}</span>;
}

function humanizeSignal(s: string): string {
  const l = s.toLowerCase();
  if (l.includes("device cookie") || l.includes("shared by"))               return "Shared Device Cookie";
  if (l.includes("failed login"))                                            return "Rapid Failed Logins, Same IP";
  if ((l.includes("within") && l.includes("ban")) || l.includes("evasion"))  return "Possible Ban Evasion";
  if (l.includes("registration") || l.includes("registrations"))            return "Registration Burst — Same IP";
  if (l.includes("same ip") || l.includes("from ip"))                       return "Same IP Address";
  return s;
}

export function CasesSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<Paged<Case>>({
    queryKey: ["canvas-cases"],
    queryFn:  () => api.get("/moderation/cases?limit=10"),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/moderation/cases/${id}`, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["canvas-cases"] }); qc.invalidateQueries({ queryKey: ["mod-summary"] }); },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });
  const banAllMut = useMutation({
    mutationFn: (caseId: string) => api.post<{ userId: string; skipped: boolean }[]>(`/moderation/cases/${caseId}/ban-all`, {}),
    onSuccess: (results) => {
      qc.invalidateQueries({ queryKey: ["canvas-cases"] });
      qc.invalidateQueries({ queryKey: ["mod-summary"] });
      const banned = results.filter((r) => !r.skipped).length;
      const skipped = results.filter((r) => r.skipped).length;
      swalToast(`Banned ${banned}${skipped ? `, ${skipped} skipped` : ""}.`, "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const handleBanAll = async (c: Case) => {
    const names = (c.linkedUsers ?? []).map((u) => u.username).join(", ");
    const ok = await swalConfirm("Ban all linked accounts?", `${names || c.linkedUserIds.join(", ")} — reason: "Multi-account policy violation"`, "Ban All");
    if (ok) banAllMut.mutate(c.id);
  };

  const total = data?.meta.total ?? 0;

  return (
    <div className="mc-pane">
      <div className="mc-sechead"><div><h3>Cases</h3><span>{total} open {total === 1 ? "investigation" : "investigations"}</span></div></div>

      {isLoading ? (
        <div className="mc-empty">Loading…</div>
      ) : !data?.data.length ? (
        <div className="mc-empty"><FontAwesomeIcon icon={faCheckDouble} className="mc-empty__ic" /><span>No open cases.</span></div>
      ) : (
        <div className="mc-cases">
          {data.data.map((c) => {
            const signals = Array.isArray(c.signals) ? c.signals as string[] : [];
            const users = c.linkedUsers ?? [];
            const ips = c.ipAddresses ?? [];
            const busy = updateMut.isPending || banAllMut.isPending;
            return (
              <div key={c.id} className="mc-case">
                <div className="mc-case__top">
                  <span className="mc-case__id">{c.type.replace(/_/g, " ")}</span>
                  <Tag crit={c.severity === "high"}>{c.severity}</Tag>
                  <Tag crit={c.status === "open"}>{c.status}</Tag>
                </div>
                <div className="mc-case__cols">
                  <div>
                    <div className="mc-case__coltitle">Users</div>
                    {users.length === 0 ? <span className="mc-case__user">—</span> : users.map((u) => (
                      <div key={u.id} className="mc-case__user">{u.username}</div>
                    ))}
                  </div>
                  <div>
                    <div className="mc-case__coltitle">Signals</div>
                    {signals.map((s, i) => (
                      <div key={i} className="mc-case__signal">
                        <FontAwesomeIcon icon={faTriangleExclamation} className="mc-case__sigic" />
                        <span>{humanizeSignal(s)}</span>
                      </div>
                    ))}
                    {ips.map((ip) => (
                      <div key={ip} className="mc-case__signal">
                        <FontAwesomeIcon icon={faTriangleExclamation} className="mc-case__sigic" />
                        <span style={{ fontFamily: "var(--ff-mono)" }}>IP: {ip}</span>
                      </div>
                    ))}
                    {signals.length === 0 && ips.length === 0 && <span className="mc-case__user">—</span>}
                  </div>
                </div>
                <div className="mc-case__foot">
                  <span className={`mc-case__sev${c.severity === "high" ? " is-crit" : ""}`}>{c.severity} severity · {timeAgo(c.createdAt)}</span>
                  <button type="button" className="mc-btn mc-btn--ghost mc-btn--sm" onClick={() => updateMut.mutate({ id: c.id, status: "reviewed" })} disabled={busy}>
                    <FontAwesomeIcon icon={faUserCheck} /> Allow
                  </button>
                  <button type="button" className="mc-btn mc-btn--danger mc-btn--sm" onClick={() => handleBanAll(c)} disabled={busy}>
                    <FontAwesomeIcon icon={faBan} /> Ban all
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

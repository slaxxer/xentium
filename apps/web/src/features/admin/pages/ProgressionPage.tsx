import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faGripVertical, faPencil, faUsers,
  faToggleOn, faToggleOff, faPlus,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { swalToast, apiErrorMessage } from "../../../lib/swal";
import { AutosaveStatus } from "../../../components/AutosaveStatus";

// ── Types ──────────────────────────────────────────────────────────────────

interface LadderEntry {
  groupId: string;
  isProgressionGroup: boolean;
  ladderPosition: number | null;
  minPosts: number | null;
  minThreads: number | null;
  minDaysMember: number | null;
  minLikesReceived: number | null;
  maxPostLength: number | null;
  maxDailyPosts: number | null;
  badgeLabel: string | null;
  badgeColor: string | null;
  badgeTextShadow: boolean;
  badgeShadowColor: string | null;
  badgeShadowX: number;
  badgeShadowY: number;
  badgeShadowBlur: number;
  userCount: number;
  group: { id: string; key: string; name: string };
}

interface GlobalSettings {
  enabled: boolean;
  notifyOnPromote: boolean;
  showProgressBar: boolean;
  thresholdLogic: "and" | "or";
}

interface LadderResponse {
  ladder: LadderEntry[];
  settings: GlobalSettings;
}

interface GroupWithProgression {
  id: string; key: string; name: string;
  progression: LadderEntry | null;
}

// ── Edit modal (per-group config) ──────────────────────────────────────────

function GroupProgressionModal({
  groupId,
  onClose,
  onSaved,
}: {
  groupId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["group-progression", groupId],
    queryFn: () => api.get<LadderEntry>(`/admin/progression/${groupId}`),
  });

  const [form, setForm] = useState<Partial<LadderEntry>>({});
  const initialized = useRef(false);
  if (data && !initialized.current) {
    setForm(data);
    initialized.current = true;
  }

  const saveMutation = useMutation({
    mutationFn: () => api.patch(`/admin/progression/${groupId}`, {
      isProgressionGroup: form.isProgressionGroup,
      ladderPosition:     form.ladderPosition,
      minPosts:           form.minPosts,
      minThreads:         form.minThreads,
      minDaysMember:      form.minDaysMember,
      minLikesReceived:   form.minLikesReceived,
      maxPostLength:      form.maxPostLength,
      maxDailyPosts:      form.maxDailyPosts,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["acp-progression"] });
      swalToast("Progression config saved!", "success");
      onSaved();
      onClose();
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  function num(val: number | null | undefined): string {
    return val == null ? "" : String(val);
  }
  function setNum(key: keyof LadderEntry, raw: string) {
    setForm(p => ({ ...p, [key]: raw === "" ? null : Number(raw) }));
  }

  const groupName = data?.group?.name ?? "Group";

  return (
    <div className="acp-modal-overlay" onClick={onClose}>
      <div
        className="acp-modal"
        style={{ maxWidth: 580, maxHeight: "85vh", overflowY: "auto" }}
        onClick={e => e.stopPropagation()}
      >
        {isLoading ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--c-fg-muted)" }}>Loading…</div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
              <div style={{
                width: 36, height: 36,
                background: form.badgeColor ? `${form.badgeColor}20` : "var(--c-accent-soft)",
                border: `1px solid ${form.badgeColor ?? "var(--c-accent-glow)"}`,
                borderRadius: "var(--radius-sm)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 18,
              }}>
                <FontAwesomeIcon icon={faUsers} style={{ color: form.badgeColor ?? "var(--c-accent)" }} />
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Progression — {groupName}</h2>
                <div style={{ fontSize: 12, color: "var(--c-fg-muted)" }}>Configure thresholds and limits</div>
              </div>
            </div>

            {/* On ladder toggle */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--c-border)", marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--c-fg)" }}>Part of progression ladder</div>
                <div style={{ fontSize: 12, color: "var(--c-fg-muted)" }}>Enable auto-promotion for users in this group</div>
              </div>
              <button type="button" onClick={() => setForm(p => ({ ...p, isProgressionGroup: !p.isProgressionGroup }))} style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                <FontAwesomeIcon
                  icon={form.isProgressionGroup ? faToggleOn : faToggleOff}
                  style={{ fontSize: 26, color: form.isProgressionGroup ? "var(--c-accent)" : "var(--c-fg-muted)" }}
                />
              </button>
            </div>

            {/* Ladder position */}
            <div className="acp-form-field">
              <label className="acp-label">Ladder position</label>
              <input className="acp-input" type="number" min={1} value={num(form.ladderPosition)} onChange={e => setNum("ladderPosition", e.target.value)} placeholder="e.g. 1 (entry level)" style={{ width: 140 }} />
              <div className="acp-hint">1 = entry level. Drag to reorder on the ladder page.</div>
            </div>

            {/* Thresholds */}
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--c-fg-muted)", letterSpacing: "0.1em", textTransform: "uppercase", margin: "16px 0 10px" }}>
              Promotion Thresholds <span style={{ fontWeight: 400, textTransform: "none" }}>(leave blank = not required)</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              {([
                ["min_posts",           "minPosts",         "Min posts"],
                ["min_threads",         "minThreads",       "Min threads"],
                ["min_days_member",     "minDaysMember",    "Min days as member"],
                ["min_likes_received",  "minLikesReceived", "Min likes received"],
              ] as [string, keyof LadderEntry, string][]).map(([, key, label]) => (
                <div key={key}>
                  <label className="acp-label">{label}</label>
                  <input className="acp-input" type="number" min={0} value={num(form[key] as number | null)} onChange={e => setNum(key, e.target.value)} placeholder="—" />
                </div>
              ))}
            </div>

            {/* Content limits */}
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--c-fg-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>
              Content Limits <span style={{ fontWeight: 400, textTransform: "none" }}>(leave blank = unlimited)</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div>
                <label className="acp-label">Max post/article length (chars)</label>
                <input className="acp-input" type="number" min={0} value={num(form.maxPostLength)} onChange={e => setNum("maxPostLength", e.target.value)} placeholder="Unlimited" />
              </div>
              <div>
                <label className="acp-label">Max daily posts</label>
                <input className="acp-input" type="number" min={0} value={num(form.maxDailyPosts)} onChange={e => setNum("maxDailyPosts", e.target.value)} placeholder="Unlimited" />
              </div>
            </div>

            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
              <button type="button" className="btn-ghost btn-sm" onClick={onClose}>Cancel</button>
              <button type="button" className="btn-primary btn-sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Toggle helper ──────────────────────────────────────────────────────────

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
      <FontAwesomeIcon
        icon={on ? faToggleOn : faToggleOff}
        style={{ fontSize: 26, color: on ? "var(--c-accent)" : "var(--c-fg-muted)" }}
      />
    </button>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export function ProgressionPage() {
  const qc = useQueryClient();
  const [editGroupId,  setEditGroupId]  = useState<string | null>(null);
  const [dragOverId,   setDragOverId]   = useState<string | null>(null);
  const dragSrcRef = useRef<string | null>(null);

  // ── Data ────────────────────────────────────────────────────────────────

  const { data, isLoading } = useQuery<LadderResponse>({
    queryKey: ["acp-progression"],
    queryFn: () => api.get("/admin/progression"),
  });

  const { data: allGroups = [] } = useQuery<GroupWithProgression[]>({
    queryKey: ["acp-progression-all-groups"],
    queryFn: () => api.get("/admin/progression/groups"),
  });

  const ladder   = data?.ladder   ?? [];
  const settings = data?.settings ?? { enabled: true, notifyOnPromote: true, showProgressBar: true, thresholdLogic: "and" };

  // Groups not yet on the ladder
  const offLadder = allGroups.filter(g => !g.progression?.isProgressionGroup);

  // ── Mutations ────────────────────────────────────────────────────────────

  const settingsMutation = useMutation({
    mutationFn: (patch: Partial<GlobalSettings>) => api.patch("/admin/progression/settings", patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["acp-progression"] });
      swalToast("Progression settings saved.", "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const reorderMutation = useMutation({
    mutationFn: (items: Array<{ groupId: string; ladderPosition: number }>) =>
      api.patch("/admin/progression/reorder", { items }),
    onMutate: async (items) => {
      await qc.cancelQueries({ queryKey: ["acp-progression"] });
      const prev = qc.getQueryData<LadderResponse>(["acp-progression"]);
      if (prev) {
        const posMap = new Map(items.map(i => [i.groupId, i.ladderPosition]));
        const optimistic = {
          ...prev,
          ladder: [...prev.ladder]
            .map(e => ({ ...e, ladderPosition: posMap.get(e.groupId) ?? e.ladderPosition }))
            .sort((a, b) => (a.ladderPosition ?? 99) - (b.ladderPosition ?? 99)),
        };
        qc.setQueryData(["acp-progression"], optimistic);
      }
      return { prev };
    },
    onError: (_e, _p, ctx) => {
      if (ctx?.prev) qc.setQueryData(["acp-progression"], ctx.prev);
      swalToast("Reorder failed — reverted.");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["acp-progression"] }),
  });

  const addToLadderMutation = useMutation({
    mutationFn: (groupId: string) => api.patch(`/admin/progression/${groupId}`, {
      isProgressionGroup: true,
      ladderPosition: ladder.length + 1,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["acp-progression"] });
      qc.invalidateQueries({ queryKey: ["acp-progression-all-groups"] });
      swalToast("Group added to ladder!", "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  // ── Drag handlers ────────────────────────────────────────────────────────

  function onDragStart(e: React.DragEvent, groupId: string) {
    e.dataTransfer.setData("text/plain", groupId);
    e.dataTransfer.effectAllowed = "move";
    dragSrcRef.current = groupId;
  }

  function onDragOver(e: React.DragEvent, groupId: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (groupId !== dragSrcRef.current) setDragOverId(groupId);
  }

  function onDragLeave() { setDragOverId(null); }

  function onDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    const src = dragSrcRef.current;
    if (!src || src === targetId) { resetDrag(); return; }

    const from = ladder.findIndex(n => n.groupId === src);
    const to   = ladder.findIndex(n => n.groupId === targetId);
    if (from === -1 || to === -1) { resetDrag(); return; }

    const reordered = [...ladder];
    const [moved] = reordered.splice(from, 1);
    if (!moved) { resetDrag(); return; }
    reordered.splice(to, 0, moved);

    reorderMutation.mutate(
      reordered.map((e, i) => ({ groupId: e.groupId, ladderPosition: i + 1 })),
    );
    resetDrag();
  }

  function resetDrag() { dragSrcRef.current = null; setDragOverId(null); }

  // ── Helpers ──────────────────────────────────────────────────────────────

  function thresholdSummary(e: LadderEntry): string {
    const parts: string[] = [];
    if (e.minPosts)        parts.push(`${e.minPosts} posts`);
    if (e.minThreads)      parts.push(`${e.minThreads} threads`);
    if (e.minDaysMember)   parts.push(`${e.minDaysMember} days`);
    if (e.minLikesReceived)parts.push(`${e.minLikesReceived} likes`);
    return parts.length ? parts.join(" · ") : "No thresholds — entry level";
  }

  function limitSummary(e: LadderEntry): string {
    if (!e.maxPostLength && !e.maxDailyPosts) return "Unlimited";
    const parts: string[] = [];
    if (e.maxPostLength) parts.push(`${e.maxPostLength.toLocaleString()} chars`);
    if (e.maxDailyPosts) parts.push(`${e.maxDailyPosts} posts/day`);
    return parts.join(" · ");
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div>
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">Access Control</div>
          <h1 className="acp-page-title">Progression</h1>
        </div>
        <AutosaveStatus saving={settingsMutation.isPending} />
      </div>

      {/* Global settings */}
      <div className="acp-card" style={{ padding: "24px", marginBottom: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: "var(--c-fg)", marginBottom: 18 }}>
          Global Settings
        </div>
        {[
          { label: "Enable progression system",      desc: "Users are automatically promoted when thresholds are met", key: "enabled"         as const },
          { label: "Notify user on promotion",       desc: "Send an in-app notification when a user is promoted",     key: "notifyOnPromote" as const },
          { label: "Show progress bar on profiles",  desc: "Display progression progress on public user profiles",    key: "showProgressBar" as const },
        ].map(({ label, desc, key }) => (
          <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--c-border)" }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--c-fg)" }}>{label}</div>
              <div style={{ fontSize: 12, color: "var(--c-fg-muted)" }}>{desc}</div>
            </div>
            <Toggle
              on={settings[key] as boolean}
              onToggle={() => settingsMutation.mutate({ [key]: !settings[key] })}
            />
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--c-fg)" }}>Threshold logic</div>
            <div style={{ fontSize: 12, color: "var(--c-fg-muted)" }}>How multiple thresholds are evaluated for promotion</div>
          </div>
          <select
            className="acp-select"
            value={settings.thresholdLogic}
            onChange={e => settingsMutation.mutate({ thresholdLogic: e.target.value as "and" | "or" })}
            style={{ width: "auto" }}
          >
            <option value="and">AND — all must be met</option>
            <option value="or">OR — any one is enough</option>
          </select>
        </div>
      </div>

      {/* Ladder */}
      <div className="acp-card" style={{ padding: 0, overflow: "hidden", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--c-border)" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: "var(--c-fg)" }}>Progression Ladder</div>
            <div style={{ fontSize: 12, color: "var(--c-fg-muted)", marginTop: 2 }}>
              Drag to reorder · Users are promoted in ascending position order
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="acp-badge acp-badge--neutral" style={{ marginTop: 0 }}>
              {ladder.length} level{ladder.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {isLoading ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--c-fg-muted)" }}>Loading…</div>
        ) : ladder.length === 0 ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--c-fg-muted)" }}>
            No groups on the progression ladder yet. Add groups below.
          </div>
        ) : (
          <>
            {/* Column headers */}
            <div style={{ display: "grid", gridTemplateColumns: "36px 40px 1fr 1fr 1fr 90px 80px", padding: "8px 18px", borderBottom: "1px solid var(--c-border)" }}>
              {["", "Pos", "Group", "Thresholds", "Limits", "Users", ""].map((h, i) => (
                <div key={i} style={{ fontSize: 11, fontWeight: 700, color: "var(--c-fg-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>{h}</div>
              ))}
            </div>

            {ladder.map((entry, i) => {
              const isOver = dragOverId === entry.groupId;
              return (
                <div
                  key={entry.groupId}
                  draggable
                  onDragStart={e => onDragStart(e, entry.groupId)}
                  onDragOver={e => onDragOver(e, entry.groupId)}
                  onDragLeave={onDragLeave}
                  onDrop={e => onDrop(e, entry.groupId)}
                  onDragEnd={resetDrag}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "36px 40px 1fr 1fr 1fr 90px 80px",
                    alignItems: "center",
                    padding: "13px 18px",
                    borderBottom: i < ladder.length - 1 ? "1px solid var(--c-border)" : "none",
                    background: isOver ? "var(--c-accent-soft)" : "transparent",
                    borderTop: isOver ? "2px solid var(--c-accent)" : "2px solid transparent",
                    transition: "background 0.1s",
                    userSelect: "none",
                  }}
                >
                  {/* Grip */}
                  <div style={{ cursor: "grab", color: "var(--c-fg-muted)", fontSize: 14 }}>
                    <FontAwesomeIcon icon={faGripVertical} />
                  </div>

                  {/* Position */}
                  <div style={{ fontSize: 14, fontWeight: 800, color: "var(--c-accent)" }}>
                    {entry.ladderPosition ?? i + 1}
                  </div>

                  {/* Group + badge */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {entry.badgeColor && (
                      <div style={{
                        width: 10, height: 10, borderRadius: "50%",
                        background: entry.badgeColor, flexShrink: 0,
                      }} />
                    )}
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--c-fg)" }}>
                        {entry.group.name}
                      </div>
                      {entry.badgeLabel && (
                        <div style={{ fontSize: 11, color: entry.badgeColor ?? "var(--c-fg-muted)" }}>
                          {entry.badgeLabel}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Thresholds */}
                  <div style={{ fontSize: 12, color: "var(--c-fg-muted)" }}>
                    {thresholdSummary(entry)}
                  </div>

                  {/* Limits */}
                  <div style={{ fontSize: 12, color: "var(--c-fg-muted)" }}>
                    {limitSummary(entry)}
                  </div>

                  {/* User count */}
                  <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, fontWeight: 700, color: "var(--c-fg)" }}>
                    <FontAwesomeIcon icon={faUsers} style={{ fontSize: 11, color: "var(--c-fg-muted)" }} />
                    {entry.userCount.toLocaleString()}
                  </div>

                  {/* Edit */}
                  <div>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => setEditGroupId(entry.groupId)}
                    >
                      <FontAwesomeIcon icon={faPencil} />
                    </button>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Groups not on ladder */}
      {offLadder.length > 0 && (
        <div className="acp-card" style={{ padding: "20px 24px" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--c-fg)", marginBottom: 12 }}>
            Add group to ladder
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {offLadder.map(g => (
              <button
                key={g.id}
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => addToLadderMutation.mutate(g.id)}
                disabled={addToLadderMutation.isPending}
              >
                <FontAwesomeIcon icon={faPlus} style={{ marginRight: 5 }} />
                {g.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editGroupId && (
        <GroupProgressionModal
          groupId={editGroupId}
          onClose={() => setEditGroupId(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["acp-progression"] });
            qc.invalidateQueries({ queryKey: ["acp-progression-all-groups"] });
          }}
        />
      )}
    </div>
  );
}

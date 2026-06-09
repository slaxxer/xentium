import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../../lib/api";
import { swalToast, apiErrorMessage } from "../../../lib/swal";
import { useAutosave } from "../../../hooks/useAutosave";
import { AutosaveStatus } from "../../../components/AutosaveStatus";
import { groupByDomain, enrichPerm } from "../../../lib/permissions";
import type { Permission } from "../../../lib/permissions";

interface Group {
  id: string;
  name: string;
  key: string;
  isSystem: boolean;
  permissions: { permission: Permission }[];
}

export function PermissionsPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState("");
  const [allowed, setAllowed] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const { data: groups = [], isLoading: groupsLoading } = useQuery<Group[]>({
    queryKey: ["acp-groups-list"],
    queryFn: () => api.get("/admin/groups"),
  });

  const { data: allPermissions = [], isLoading: permsLoading } = useQuery<Permission[]>({
    queryKey: ["acp-permissions-all"],
    queryFn: () => api.get("/admin/permissions"),
  });

  useEffect(() => {
    const gs = groups as Group[];
    if (!selectedId && gs.length > 0 && gs[0]) {
      setSelectedId(gs[0].id);
    }
  }, [groups, selectedId]);

  useEffect(() => {
    const gs = groups as Group[];
    const sel = gs.find((g) => g.id === selectedId);
    setAllowed(new Set(sel?.permissions.map((gp) => gp.permission.key) ?? []));
  }, [selectedId, groups]);

  const selected    = (groups as Group[]).find((g) => g.id === selectedId);
  const grantedKeys = new Set(selected?.permissions.map((gp) => gp.permission.key) ?? []);

  const dirty =
    allowed.size !== grantedKeys.size ||
    [...allowed].some((k) => !grantedKeys.has(k));

  const sortedDomains = groupByDomain(allPermissions as Permission[]);

  function toggle(key: string) {
    if (!selectedId || saving) return;
    setAllowed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleSave() {
    if (!selectedId || saving || !dirty) return;
    const toGrant  = [...allowed].filter((k) => !grantedKeys.has(k));
    const toRevoke = [...grantedKeys].filter((k) => !allowed.has(k));
    setSaving(true);
    try {
      await Promise.all([
        ...toGrant.map((k) => api.post(`/admin/groups/${selectedId}/permissions`, { key: k })),
        ...toRevoke.map((k) => api.delete(`/admin/groups/${selectedId}/permissions/${k}`)),
      ]);
      queryClient.invalidateQueries({ queryKey: ["acp-groups-list"] });
      swalToast("Permissions saved", "success");
    } catch (e) {
      swalToast(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  // Auto-save when the draft permission set diverges from the group's saved set.
  // Sets aren't JSON-serializable, so compare sorted arrays. Switching groups
  // re-seeds `allowed` (effect above), so both sides change together — no save.
  useAutosave({
    value:      [...allowed].sort(),
    savedValue: selected ? [...grantedKeys].sort() : undefined,
    onSave:     () => { void handleSave(); },
  });

  const isLoading = groupsLoading || permsLoading;

  if (isLoading) {
    return <div style={{ padding: "2rem", color: "var(--c-fg-muted)" }}>Loading…</div>;
  }

  return (
    <div>
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">Access Control</div>
          <h1 className="acp-page-title">Permissions</h1>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Link to="/admin/groups" className="btn-ghost btn-sm">Manage Groups</Link>
          <AutosaveStatus saving={saving} />
        </div>
      </div>

      {/* Group selector */}
      <div className="acp-card" style={{ padding: "14px 20px", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--c-fg-muted)" }}>
            Editing permissions for:
          </span>
          <select
            className="acp-select"
            style={{ width: "auto", fontWeight: 700 }}
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {(groups as Group[]).map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          {selected && (
            <span style={{ fontSize: 13, color: "var(--c-fg-muted)", marginLeft: "auto" }}>
              {allowed.size} of {(allPermissions as Permission[]).length} permissions granted
            </span>
          )}
        </div>
      </div>

      {/* Domains */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {sortedDomains.map(([domain, perms]) => {
          const domainGranted = perms.filter((p) => allowed.has(p.key)).length;
          return (
            <div key={domain} className="acp-card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "12px 20px",
                borderBottom: "1px solid var(--c-border)",
              }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: "var(--c-fg)" }}>
                  {domain}
                </div>
                <div style={{ fontSize: 12, color: "var(--c-fg-muted)" }}>
                  {domainGranted}/{perms.length} granted
                </div>
              </div>
              <div>
                {perms.map((p, i) => {
                  const ep = enrichPerm(p);
                  const on = allowed.has(p.key);
                  return (
                    <div
                      key={p.key}
                      onClick={() => toggle(p.key)}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--c-bg-hover)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "11px 20px",
                        borderBottom: i < perms.length - 1 ? "1px solid var(--c-border)" : "none",
                        background: "transparent",
                        cursor: saving ? "wait" : "pointer",
                        transition: "background .15s",
                        userSelect: "none",
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--c-fg)" }}>{ep.label}</div>
                        <div style={{ fontSize: 11, color: "var(--c-fg-muted)", fontFamily: "monospace", marginTop: 2 }}>{p.key}</div>
                      </div>
                      <div style={{
                        width: 40, height: 22, borderRadius: 100,
                        background: on ? "var(--c-accent)" : "var(--c-border)",
                        position: "relative", flexShrink: 0,
                        transition: "background .2s",
                      }}>
                        <div style={{
                          position: "absolute", top: 3, width: 16, height: 16,
                          background: "#fff", borderRadius: "50%",
                          left: on ? 21 : 3,
                          transition: "left .2s",
                        }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {(allPermissions as Permission[]).length === 0 && (
        <div className="acp-card" style={{ textAlign: "center", padding: "3rem", color: "var(--c-fg-muted)" }}>
          No permissions registered
        </div>
      )}
    </div>
  );
}

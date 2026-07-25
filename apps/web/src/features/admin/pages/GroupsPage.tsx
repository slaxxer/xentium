import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../lib/api";
import { swalToast, apiErrorMessage, swalConfirm } from "../../../lib/swal";
import { groupByDomain } from "../../../lib/permissions";
import type { Permission } from "../../../lib/permissions";
import { slotRegistry } from "../../../plugins/slotRegistry";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faSave, faTrash, faUsers, faKey, faDiagramProject, faPencil, faToggleOn, faToggleOff, faChevronDown, faArrowUp, faArrowDown } from "@fortawesome/free-solid-svg-icons";

interface Group {
  id: string;
  name: string;
  key: string;
  icon: string | null;
  isSystem: boolean;
  displayOrder: number;
  showInTeam: boolean;
  _count: { users: number; permissions: number };
  permissions: { permission: Permission }[];
  progression: {
    badgeColor: string | null;
    badgeLabel: string | null;
    badgeTextShadow?: boolean;
    badgeShadowColor?: string | null;
    badgeShadowX?: number;
    badgeShadowY?: number;
    badgeShadowBlur?: number;
  } | null;
}

// ── Shared badge "glow" (username text-shadow) editor ───────────────────────
// Used by both the create and edit group modals so the controls stay identical.

interface GlowValue {
  badgeTextShadow: boolean;
  badgeShadowColor: string | null;
  badgeShadowX: number;
  badgeShadowY: number;
  badgeShadowBlur: number;
}

const GLOW_DEFAULTS: GlowValue = {
  badgeTextShadow: false, badgeShadowColor: null, badgeShadowX: 1, badgeShadowY: 1, badgeShadowBlur: 20,
};

function GlowFields({ value, badgeColor, previewLabel, onChange }: {
  value: GlowValue;
  badgeColor: string;
  previewLabel: string;
  onChange: (patch: Partial<GlowValue>) => void;
}) {
  const { t } = useTranslation("acp");
  return (
    <div className="acp-form-field">
      <label className="acp-check" style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={value.badgeTextShadow}
          onChange={(e) => onChange({ badgeTextShadow: e.target.checked })}
          style={{ flexShrink: 0 }}
        />
        <span style={{ flex: 1 }}>
          <span style={{ fontWeight: 700 }}>{t("groups.glow")}</span>
          <span className="acp-hint" style={{ display: "block", marginTop: 2 }}>
            {t("groups.glowDesc")}
          </span>
        </span>
        <span style={{
          fontWeight: 800, fontSize: 15,
          color: badgeColor,
          textShadow: value.badgeTextShadow
            ? `${value.badgeShadowX}px ${value.badgeShadowY}px ${value.badgeShadowBlur}px ${value.badgeShadowColor || badgeColor}`
            : undefined,
        }}>
          {previewLabel || t("groups.preview")}
        </span>
      </label>

      {value.badgeTextShadow && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 64px 64px 64px", gap: 10, marginTop: 12 }}>
          <div>
            <label className="acp-label">{t("groups.glowColor")}</label>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="color"
                value={value.badgeShadowColor ?? badgeColor}
                onChange={(e) => onChange({ badgeShadowColor: e.target.value })}
                style={{ width: 40, height: 38, border: "1px solid var(--c-border)", borderRadius: "var(--radius-sm)", cursor: "pointer", flexShrink: 0 }}
              />
              {value.badgeShadowColor != null
                ? <button type="button" className="btn-ghost btn-sm" onClick={() => onChange({ badgeShadowColor: null })} title={t("groups.useBadge")}>{t("groups.badgeReset")}</button>
                : <span style={{ fontSize: 11, color: "var(--c-fg-muted)" }}>{t("groups.eqBadge")}</span>}
            </div>
          </div>
          <div>
            <label className="acp-label">X</label>
            <input className="acp-input" type="number" min={-20} max={20} value={value.badgeShadowX} onChange={(e) => onChange({ badgeShadowX: Number(e.target.value) })} />
          </div>
          <div>
            <label className="acp-label">Y</label>
            <input className="acp-input" type="number" min={-20} max={20} value={value.badgeShadowY} onChange={(e) => onChange({ badgeShadowY: Number(e.target.value) })} />
          </div>
          <div>
            <label className="acp-label">{t("groups.blur")}</label>
            <input className="acp-input" type="number" min={0} max={60} value={value.badgeShadowBlur} onChange={(e) => onChange({ badgeShadowBlur: Number(e.target.value) })} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Collapsible domain permission list ─────────────────────────────────────

function DomainList({
  allPermissions,
  selected,
  onToggle,
}: {
  allPermissions: Permission[];
  selected: Set<string>;
  onToggle: (key: string) => void;
}) {
  const { t } = useTranslation("acp");
  const domains = groupByDomain(allPermissions);
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(domains.map(([d]) => d)),
  );

  function toggleDomain(domain: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain); else next.add(domain);
      return next;
    });
  }

  if (domains.length === 0) {
    return <div style={{ color: "var(--c-fg-muted)", fontSize: 13 }}>{t("groups.noPerms")}</div>;
  }

  return (
    <>
      {domains.map(([domain, perms]) => {
        const isCollapsed = collapsed.has(domain);
        const checkedCount = perms.filter((p) => selected.has(p.key)).length;
        return (
          <div key={domain} style={{ marginBottom: "0.75rem" }}>
            {/* Domain header */}
            <button
              type="button"
              onClick={() => toggleDomain(domain)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                width: "100%", background: "var(--c-surface)", border: "1px solid var(--c-border)",
                borderRadius: isCollapsed ? "var(--radius-sm)" : "var(--radius-sm) var(--radius-sm) 0 0",
                padding: "7px 12px", cursor: "pointer",
                transition: "background .15s",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--c-border)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--c-surface)"; }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <FontAwesomeIcon
                  icon={faChevronDown}
                  style={{
                    fontSize: 10, color: "var(--c-fg-muted)",
                    transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                    transition: "transform .2s",
                  }}
                />
                <span style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-fg)" }}>
                  {domain}
                </span>
              </div>
              <span style={{ fontSize: 11, color: "var(--c-fg-muted)" }}>
                {checkedCount}/{perms.length}
              </span>
            </button>

            {/* Rows */}
            {!isCollapsed && (
              <div style={{ border: "1px solid var(--c-border)", borderTop: "none", borderRadius: "0 0 var(--radius-sm) var(--radius-sm)", overflow: "hidden" }}>
                {perms.map((p, i) => (
                  <label
                    key={p.key}
                    className="acp-perm-row"
                    style={{
                      borderBottom: i < perms.length - 1 ? "1px solid var(--c-border)" : "none",
                      borderRadius: 0,
                      padding: "8px 12px",
                    }}
                  >
                    <input type="checkbox" checked={selected.has(p.key)} onChange={() => onToggle(p.key)} />
                    <span style={{ flex: 1 }}>{p.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

// ── Shared sticky footer ────────────────────────────────────────────────────

const MODAL_PAD = "var(--sp-6)";

function ModalFooter({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", gap: "0.75rem", justifyContent: "flex-end",
      bottom: 0,
      background: "rgba(0,0,0,0.1)",
      backdropFilter: "blur(10px)",
      WebkitBackdropFilter: "blur(10px)",
      borderTop: "1px solid rgba(255,255,255,0.06)",
      padding: `12px ${MODAL_PAD}`,
      margin: `8px calc(-1 * ${MODAL_PAD}) calc(-1 * ${MODAL_PAD})`,
      borderRadius: "0 0 var(--radius-md) var(--radius-md)",
    }}>
      {children}
    </div>
  );
}

// ── Create group modal ──────────────────────────────────────────────────────

function CreateGroupModal({
  allPermissions,
  onClose,
  onCreated,
}: {
  allPermissions: Permission[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation("acp");
  const DEFAULT_COLOR = "#7c6af7";
  const [name,        setName]        = useState("");
  const [key,         setKey]         = useState("");
  const [color,       setColor]       = useState(DEFAULT_COLOR);
  const [badgeLabel,  setBadgeLabel]  = useState("");
  const [glow,        setGlow]        = useState<GlowValue>(GLOW_DEFAULTS);
  const [iconFile,    setIconFile]    = useState<File | null>(null);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [selected,    setSelected]    = useState<Set<string>>(new Set());
  const [showInTeam,  setShowInTeam]  = useState(false);
  const [isPending,   setIsPending]   = useState(false);

  function handleIconChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setIconFile(file);
    setIconPreview(URL.createObjectURL(file));
  }

  function togglePerm(k: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  async function handleCreate() {
    setIsPending(true);
    try {
      const group = await api.post("/admin/groups", { name, key, showInTeam }) as { id: string };

      const followUps: Promise<unknown>[] = [
        api.patch(`/admin/progression/${group.id}`, {
          badgeColor: color,
          badgeLabel: badgeLabel.trim() || null,
          badgeTextShadow:  glow.badgeTextShadow,
          badgeShadowColor: glow.badgeShadowColor,
          badgeShadowX:     glow.badgeShadowX,
          badgeShadowY:     glow.badgeShadowY,
          badgeShadowBlur:  glow.badgeShadowBlur,
        }),
      ];
      if (iconFile) {
        const fd = new FormData();
        fd.append("file", iconFile);
        followUps.push(api.post(`/admin/groups/${group.id}/icon`, fd));
      }
      if (selected.size > 0) {
        followUps.push(
          api.put(`/admin/groups/${group.id}/permissions`, {
            permissionKeys: Array.from(selected),
          }),
        );
      }
      await Promise.all(followUps);

      onCreated();
      onClose();
      swalToast(t("groups.toastCreated"), "success");
    } catch (e) {
      swalToast(apiErrorMessage(e));
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="acp-modal-overlay" onClick={onClose}>
      <div
        className="acp-modal"
        style={{ maxWidth: 560, maxHeight: "85vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Live preview header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{
            width: 44, height: 44, flexShrink: 0,
            background: iconPreview ? "transparent" : `${color}20`,
            border: `2px solid ${color}50`,
            borderRadius: "var(--radius-sm)",
            display: "flex", alignItems: "center", justifyContent: "center",
            overflow: "hidden",
          }}>
            {iconPreview
              ? <img src={iconPreview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              : <FontAwesomeIcon icon={faUsers} style={{ color, fontSize: 18 }} />
            }
          </div>
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: "1.1rem" }}>{t("groups.createTitle")}</h2>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700,
              background: `${color}20`, color, border: `1px solid ${color}40`,
            }}>
              {iconPreview && <img src={iconPreview} alt="" style={{ width: 11, height: 11, borderRadius: 2, objectFit: "cover" }} />}
              {name || t("groups.namePreview")}
            </span>
          </div>
        </div>

        {/* ── Identity ───────────────────────────────────────────────────── */}
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--c-fg-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>
          {t("groups.identity")}
        </div>

        <div className="acp-form-field">
          <label className="acp-label">{t("groups.name")}</label>
          <input className="acp-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("groups.namePlaceholderCreate")} />
        </div>
        <div className="acp-form-field">
          <label className="acp-label">{t("groups.key")}</label>
          <input className="acp-input" value={key} onChange={(e) => setKey(e.target.value)} placeholder={t("groups.keyPlaceholder")} />
          <div className="acp-hint">{t("groups.keyHintCreate")}</div>
        </div>

        <div className="acp-form-field">
          <label className="acp-label">{t("groups.badgeColor")}</label>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              style={{ width: 48, height: 38, border: "1px solid var(--c-border)", borderRadius: "var(--radius-sm)", cursor: "pointer", padding: 2 }}
            />
            <input
              className="acp-input"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="#7c6af7"
              style={{ flex: 1, fontFamily: "monospace" }}
            />
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: color, flexShrink: 0, border: "2px solid var(--c-border)" }} />
          </div>
        </div>

        <div className="acp-form-field">
          <label className="acp-label">{t("groups.badgeLabel")}</label>
          <input className="acp-input" value={badgeLabel} onChange={(e) => setBadgeLabel(e.target.value)} placeholder={t("groups.badgeLabelPlaceholder")} />
        </div>

        <GlowFields value={glow} badgeColor={color} previewLabel={badgeLabel || name} onChange={(patch) => setGlow((p) => ({ ...p, ...patch }))} />

        <div className="acp-form-field">
          <label className="acp-label">{t("groups.icon")}</label>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 52, height: 52, flexShrink: 0,
              borderRadius: "var(--radius-sm)",
              border: `2px dashed ${iconPreview ? color : "var(--c-border)"}`,
              background: iconPreview ? "transparent" : "var(--c-surface)",
              display: "flex", alignItems: "center", justifyContent: "center",
              overflow: "hidden",
            }}>
              {iconPreview
                ? <img src={iconPreview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : <FontAwesomeIcon icon={faUsers} style={{ color: "var(--c-fg-muted)", fontSize: 20 }} />
              }
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="create-group-icon" className="btn-ghost btn-sm" style={{ display: "inline-block", cursor: "pointer" }}>
                {iconPreview ? t("groups.changeImage") : t("groups.uploadImage")}
              </label>
              <input
                id="create-group-icon"
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                style={{ display: "none" }}
                onChange={handleIconChange}
              />
              {iconPreview && (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  style={{ marginLeft: 8, color: "var(--c-danger)" }}
                  onClick={() => { setIconFile(null); setIconPreview(null); }}
                >
                  {t("groups.remove")}
                </button>
              )}
              <div className="acp-hint" style={{ marginTop: 4 }}>{t("groups.iconHintCreate")}</div>
            </div>
          </div>
        </div>

        <div className="acp-form-field">
          <label className="acp-check" style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={showInTeam} onChange={(e) => setShowInTeam(e.target.checked)} style={{ marginTop: 3 }} />
            <span>
              <span style={{ fontWeight: 700 }}>{t("groups.showTeam")}</span>
              <span className="acp-hint" style={{ display: "block", marginTop: 2 }}>
                {t("groups.showTeamDescCreate")}
              </span>
            </span>
          </label>
        </div>

        {/* ── Permissions ────────────────────────────────────────────────── */}
        <div style={{ borderTop: "1px solid var(--c-border)", margin: "20px 0 14px", paddingTop: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--c-fg-muted)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              {t("groups.permissions")}
            </div>
            <span style={{ fontSize: 12, color: "var(--c-fg-muted)" }}>
              {t("groups.selectedCount", { count: selected.size })}
            </span>
          </div>
          <DomainList allPermissions={allPermissions} selected={selected} onToggle={togglePerm} />
        </div>

        <ModalFooter>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>{t("groups.cancel")}</button>
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={!name.trim() || !key.trim() || isPending}
            onClick={handleCreate}
          >
            <FontAwesomeIcon icon={faPlus} style={{ marginRight: 5 }} />
            {isPending ? t("groups.creating") : t("groups.createTitle")}
          </button>
        </ModalFooter>
      </div>
    </div>
  );
}

// ── Edit group modal (name + badge color + icon — works for ALL groups) ──────

function EditGroupModal({ group, onClose, onSaved }: { group: Group; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const [name,       setName]       = useState(group.name);
  const [color,      setColor]      = useState(group.progression?.badgeColor ?? "#7c6af7");
  const [badgeLabel, setBadgeLabel] = useState(group.progression?.badgeLabel ?? "");
  const [glow,       setGlow]       = useState<GlowValue>({
    badgeTextShadow:  group.progression?.badgeTextShadow  ?? false,
    badgeShadowColor: group.progression?.badgeShadowColor ?? null,
    badgeShadowX:     group.progression?.badgeShadowX     ?? 1,
    badgeShadowY:     group.progression?.badgeShadowY     ?? 1,
    badgeShadowBlur:  group.progression?.badgeShadowBlur  ?? 20,
  });
  const [iconFile,   setIconFile]   = useState<File | null>(null);
  const [iconPreview, setIconPreview] = useState<string | null>(
    group.icon ? `/uploads/${group.icon}` : null,
  );
  const [showInTeam, setShowInTeam] = useState(group.showInTeam);

  const nameMutation = useMutation({
    mutationFn: () => api.patch(`/admin/groups/${group.id}`, { name }),
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const teamMutation = useMutation({
    mutationFn: () => api.patch(`/admin/groups/${group.id}`, { showInTeam }),
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const badgeMutation = useMutation({
    mutationFn: () => api.patch(`/admin/progression/${group.id}`, {
      badgeColor: color,
      badgeLabel: badgeLabel.trim() || null,
      badgeTextShadow:  glow.badgeTextShadow,
      badgeShadowColor: glow.badgeShadowColor,
      badgeShadowX:     glow.badgeShadowX,
      badgeShadowY:     glow.badgeShadowY,
      badgeShadowBlur:  glow.badgeShadowBlur,
    }),
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const iconMutation = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("file", iconFile!);
      return api.post(`/admin/groups/${group.id}/icon`, fd);
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  function handleIconChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setIconFile(file);
    setIconPreview(URL.createObjectURL(file));
  }

  async function handleSave() {
    const p = group.progression;
    const nameChanged  = name.trim() !== group.name;
    const badgeChanged =
      color !== (p?.badgeColor ?? "#7c6af7") ||
      (badgeLabel.trim() || null) !== (p?.badgeLabel ?? null) ||
      glow.badgeTextShadow !== (p?.badgeTextShadow ?? false) ||
      (glow.badgeShadowColor ?? null) !== (p?.badgeShadowColor ?? null) ||
      glow.badgeShadowX !== (p?.badgeShadowX ?? 1) ||
      glow.badgeShadowY !== (p?.badgeShadowY ?? 1) ||
      glow.badgeShadowBlur !== (p?.badgeShadowBlur ?? 20);
    const iconChanged  = !!iconFile;
    const teamChanged  = showInTeam !== group.showInTeam;

    const tasks: Promise<unknown>[] = [];
    if (nameChanged)  tasks.push(nameMutation.mutateAsync());
    if (badgeChanged) tasks.push(badgeMutation.mutateAsync());
    if (iconChanged)  tasks.push(iconMutation.mutateAsync());
    if (teamChanged)  tasks.push(teamMutation.mutateAsync());

    if (tasks.length === 0) { onClose(); return; }

    await Promise.all(tasks).then(() => {
      qc.invalidateQueries({ queryKey: ["acp-groups-list"] });
      qc.invalidateQueries({ queryKey: ["acp-progression"] });
      swalToast(t("groups.toastUpdated"), "success");
      onSaved();
      onClose();
    });
  }

  const isPending = nameMutation.isPending || badgeMutation.isPending || iconMutation.isPending || teamMutation.isPending;

  return (
    <div className="acp-modal-overlay" onClick={onClose}>
      <div className="acp-modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        {/* Header: icon preview + badge pill preview — both independent */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          {/* Icon slot */}
          <div style={{
            width: 44, height: 44, flexShrink: 0,
            background: iconPreview ? "transparent" : `${color}20`,
            border: `2px solid ${color}50`,
            borderRadius: "var(--radius-sm)",
            display: "flex", alignItems: "center", justifyContent: "center",
            overflow: "hidden",
          }}>
            {iconPreview
              ? <img src={iconPreview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              : <FontAwesomeIcon icon={faUsers} style={{ color, fontSize: 18 }} />
            }
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, fontSize: "1.1rem" }}>{t("groups.editTitle")}</h2>
              {/* Live badge pill preview */}
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                background: `${color}20`, color, border: `1px solid ${color}40`,
              }}>
                {iconPreview && <img src={iconPreview} alt="" style={{ width: 11, height: 11, borderRadius: 2, objectFit: "cover" }} />}
                {badgeLabel || name}
              </span>
            </div>
            {group.isSystem && (
              <div style={{ fontSize: 11, color: "var(--c-fg-muted)", marginTop: 3 }}>
                Protected group — key cannot be changed
              </div>
            )}
          </div>
        </div>

        {/* Name */}
        <div className="acp-form-field">
          <label className="acp-label">{t("groups.name")}</label>
          <input className="acp-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("groups.namePlaceholderEdit")} />
        </div>

        {/* Key */}
        <div className="acp-form-field">
          <label className="acp-label">{t("groups.key")}</label>
          <input className="acp-input" value={group.key} disabled style={{ opacity: 0.5, cursor: "not-allowed" }} />
          <div className="acp-hint">{t("groups.keyHintEdit")}</div>
        </div>

        {/* Team page */}
        <div className="acp-form-field">
          <label className="acp-check" style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={showInTeam} onChange={(e) => setShowInTeam(e.target.checked)} style={{ marginTop: 3 }} />
            <span>
              <span style={{ fontWeight: 700 }}>{t("groups.showTeam")}</span>
              <span className="acp-hint" style={{ display: "block", marginTop: 2 }}>
                {t("groups.showTeamDescEdit")}
              </span>
            </span>
          </label>
        </div>

        {/* Badge color */}
        <div className="acp-form-field">
          <label className="acp-label">{t("groups.badgeColor")}</label>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              style={{ width: 48, height: 38, border: "1px solid var(--c-border)", borderRadius: "var(--radius-sm)", cursor: "pointer", padding: 2 }}
            />
            <input
              className="acp-input"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="#7c6af7"
              style={{ flex: 1, fontFamily: "monospace" }}
            />
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: color, flexShrink: 0, border: "2px solid var(--c-border)" }} />
          </div>
          <div className="acp-hint">{t("groups.badgeColorHint")}</div>
        </div>

        {/* Badge label */}
        <div className="acp-form-field">
          <label className="acp-label">{t("groups.badgeLabel")}</label>
          <input className="acp-input" value={badgeLabel} onChange={(e) => setBadgeLabel(e.target.value)} placeholder={t("groups.badgeLabelPlaceholder")} />
        </div>

        {/* Username glow */}
        <GlowFields value={glow} badgeColor={color} previewLabel={badgeLabel || name} onChange={(patch) => setGlow((prev) => ({ ...prev, ...patch }))} />

        {/* Icon upload */}
        <div className="acp-form-field">
          <label className="acp-label">{t("groups.icon")}</label>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {/* Preview */}
            <div style={{
              width: 52, height: 52, flexShrink: 0,
              borderRadius: "var(--radius-sm)",
              border: `2px dashed ${iconPreview ? color : "var(--c-border)"}`,
              background: iconPreview ? "transparent" : "var(--c-surface)",
              display: "flex", alignItems: "center", justifyContent: "center",
              overflow: "hidden",
            }}>
              {iconPreview
                ? <img src={iconPreview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : <FontAwesomeIcon icon={faUsers} style={{ color: "var(--c-fg-muted)", fontSize: 20 }} />
              }
            </div>
            <div style={{ flex: 1 }}>
              <label
                htmlFor={`group-icon-${group.id}`}
                className="btn-ghost btn-sm"
                style={{ display: "inline-block", cursor: "pointer" }}
              >
                {iconPreview ? t("groups.changeImage") : t("groups.uploadImage")}
              </label>
              <input
                id={`group-icon-${group.id}`}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                style={{ display: "none" }}
                onChange={handleIconChange}
              />
              {iconPreview && (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  style={{ marginLeft: 8, color: "var(--c-danger)" }}
                  onClick={() => { setIconFile(null); setIconPreview(null); }}
                >
                  {t("groups.remove")}
                </button>
              )}
              <div className="acp-hint" style={{ marginTop: 4 }}>
                {t("groups.iconHintEdit")}
              </div>
            </div>
          </div>
        </div>

        <ModalFooter>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>{t("groups.cancel")}</button>
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={isPending || !name.trim()}
            onClick={handleSave}
          >
            <FontAwesomeIcon icon={faSave} style={{ marginRight: 5 }} />
            {isPending ? t("groups.saving") : t("groups.save")}
          </button>
        </ModalFooter>
      </div>
    </div>
  );
}

// ── Permissions modal ───────────────────────────────────────────────────────

function PermissionsModal({
  group, allPermissions, onClose, onSaved,
}: {
  group: Group;
  allPermissions: Permission[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation("acp");
  const [selected, setSelected] = useState<Set<string>>(
    new Set(group.permissions.map((gp) => gp.permission.key)),
  );

  const mutation = useMutation({
    mutationFn: () =>
      api.put(`/admin/groups/${group.id}/permissions`, { permissionKeys: Array.from(selected) }),
    onSuccess: () => { onSaved(); onClose(); swalToast(t("groups.toastPerms"), "success"); },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  return (
    <div className="acp-modal-overlay" onClick={onClose}>
      <div
        className="acp-modal"
        style={{ maxWidth: 600, maxHeight: "80vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginBottom: "0.5rem", fontSize: "1.1rem" }}>
          {t("groups.permsTitle", { name: group.name })}
        </h2>
        <p style={{ color: "var(--c-fg-muted)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
          {t("groups.permsSelected", { count: selected.size })}
        </p>

        <DomainList allPermissions={allPermissions} selected={selected} onToggle={toggle} />

        <ModalFooter>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>{t("groups.cancel")}</button>
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            <FontAwesomeIcon icon={faSave} /> {t("groups.savePerms")}
          </button>
        </ModalFooter>
      </div>
    </div>
  );
}

// ── Progression modal ───────────────────────────────────────────────────────

interface ProgressionData {
  groupId: string;
  isProgressionGroup: boolean;
  ladderPosition: number | null;
  minPosts: number | null;
  minThreads: number | null;
  minDaysMember: number | null;
  minLikesReceived: number | null;
  maxPostLength: number | null;
  maxDailyPosts: number | null;
}

function ProgressionModal({ group, onClose }: { group: Group; onClose: () => void }) {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<ProgressionData>({
    queryKey: ["group-progression", group.id],
    queryFn:  () => api.get(`/admin/progression/${group.id}`),
  });

  const [form, setForm] = useState<Partial<ProgressionData>>({});
  const initialized     = useRef(false);
  if (data && !initialized.current) { setForm(data); initialized.current = true; }

  // Plugin-contributed per-group config panels — each renders as its own tab so
  // the dialog stays compact no matter how many plugins add settings.
  const panels    = slotRegistry.getGroupConfigPanels();
  const [tab, setTab] = useState<string>("progression");
  const activePanel = panels.find((p) => p.id === tab);

  const saveMutation = useMutation({
    mutationFn: () => api.patch(`/admin/progression/${group.id}`, {
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
      qc.invalidateQueries({ queryKey: ["acp-groups-list"] });
      qc.invalidateQueries({ queryKey: ["group-progression", group.id] });
      swalToast(t("groups.toastProg"), "success");
      onClose();
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  function num(v: number | null | undefined) { return v == null ? "" : String(v); }
  function setNum(k: keyof ProgressionData, raw: string) {
    setForm(p => ({ ...p, [k]: raw === "" ? null : Number(raw) }));
  }

  return (
    <div className="acp-modal-overlay" onClick={onClose}>
      <div
        className="acp-modal"
        style={{ maxWidth: 560, maxHeight: "85vh", overflowY: "auto" }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <FontAwesomeIcon icon={faDiagramProject} style={{ color: "var(--c-accent)", fontSize: 18 }} />
          <h2 style={{ fontSize: "1.1rem", margin: 0 }}>{t("groups.progTitle", { name: group.name })}</h2>
        </div>
        <p style={{ fontSize: 13, color: "var(--c-fg-muted)", marginBottom: 20 }}>
          {t("groups.progSub")}
        </p>

        {panels.length > 0 && (
          <div style={{ display: "flex", gap: 4, marginBottom: 18, borderBottom: "1px solid var(--c-border)" }}>
            {[{ id: "progression", label: t("groups.tabProgression") }, ...panels].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setTab(p.id)}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  padding: "8px 12px", fontSize: 13, fontWeight: 600,
                  color: tab === p.id ? "var(--c-accent)" : "var(--c-fg-muted)",
                  borderBottom: `2px solid ${tab === p.id ? "var(--c-accent)" : "transparent"}`,
                  marginBottom: -1,
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        {activePanel ? (
          <activePanel.component groupId={group.id} groupName={group.name} />
        ) : isLoading ? (
          <div style={{ padding: "1rem", textAlign: "center", color: "var(--c-fg-muted)" }}>{t("groups.loading")}</div>
        ) : (
          <>
            {/* On ladder */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--c-border)", marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--c-fg)" }}>{t("groups.onLadder")}</div>
                <div style={{ fontSize: 12, color: "var(--c-fg-muted)" }}>{t("groups.onLadderDesc")}</div>
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
              <label className="acp-label">{t("groups.ladderPos")}</label>
              <input className="acp-input" type="number" min={1} value={num(form.ladderPosition)} onChange={e => setNum("ladderPosition", e.target.value)} placeholder={t("groups.ladderPosPlaceholder")} style={{ width: 160 }} />
              <div className="acp-hint">{t("groups.ladderPosHint")}</div>
            </div>

            {/* Thresholds */}
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--c-fg-muted)", letterSpacing: "0.1em", textTransform: "uppercase", margin: "16px 0 10px" }}>
              {t("groups.thresholds")} <span style={{ fontWeight: 400, textTransform: "none" }}>{t("groups.thresholdsNote")}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
              {([
                ["minPosts",         t("groups.minPosts")],
                ["minThreads",       t("groups.minThreads")],
                ["minDaysMember",    t("groups.minDays")],
                ["minLikesReceived", t("groups.minLikes")],
              ] as [keyof ProgressionData, string][]).map(([key, label]) => (
                <div key={key}>
                  <label className="acp-label">{label}</label>
                  <input className="acp-input" type="number" min={0} value={num(form[key] as number | null)} onChange={e => setNum(key, e.target.value)} placeholder="—" />
                </div>
              ))}
            </div>

            {/* Content limits */}
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--c-fg-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>
              {t("groups.limits")} <span style={{ fontWeight: 400, textTransform: "none" }}>{t("groups.limitsNote")}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
              <div>
                <label className="acp-label">{t("groups.maxLen")}</label>
                <input className="acp-input" type="number" min={0} value={num(form.maxPostLength)} onChange={e => setNum("maxPostLength", e.target.value)} placeholder={t("groups.unlimited")} />
              </div>
              <div>
                <label className="acp-label">{t("groups.maxDaily")}</label>
                <input className="acp-input" type="number" min={0} value={num(form.maxDailyPosts)} onChange={e => setNum("maxDailyPosts", e.target.value)} placeholder={t("groups.unlimited")} />
              </div>
            </div>

            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
              <button type="button" className="btn-ghost btn-sm" onClick={onClose}>{t("groups.cancel")}</button>
              <button type="button" className="btn-primary btn-sm" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                <FontAwesomeIcon icon={faSave} style={{ marginRight: 5 }} />
                {saveMutation.isPending ? t("groups.saving") : t("groups.save")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

export function GroupsPage() {
  const { t } = useTranslation("acp");
  const queryClient = useQueryClient();
  const [showCreate,      setShowCreate]      = useState(false);
  const [editGroup,       setEditGroup]       = useState<Group | null>(null);
  const [editPerms,       setEditPerms]       = useState<Group | null>(null);
  const [editProgression, setEditProgression] = useState<Group | null>(null);

  const { data: groups = [], isLoading } = useQuery<Group[]>({
    queryKey: ["acp-groups-list"],
    queryFn: () => api.get("/admin/groups"),
  });

  const { data: allPermissions = [] } = useQuery<Permission[]>({
    queryKey: ["acp-permissions-all"],
    queryFn: () => api.get("/admin/permissions"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/groups/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["acp-groups-list"] });
      swalToast(t("groups.toastDeleted"), "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  async function handleDelete(g: Group) {
    const result = await swalConfirm(
      t("groups.deleteTitle"),
      t("groups.deleteText", { name: g.name }),
      t("groups.delete"),
      t("groups.cancel"),
    );
    if (result) deleteMutation.mutate(g.id);
  }

  const reorderMutation = useMutation({
    mutationFn: (items: { id: string; displayOrder: number }[]) =>
      api.put("/admin/groups/reorder", { items }),
    onSuccess: (fresh) => {
      // Server returns the freshly-ordered list — seed the cache so the move
      // is instant and the badge precedence everywhere updates on next fetch.
      queryClient.setQueryData(["acp-groups-list"], fresh);
      queryClient.invalidateQueries({ queryKey: ["acp-groups-list"] });
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  function moveGroup(index: number, dir: -1 | 1) {
    const list = groups as Group[];
    const target = index + dir;
    if (target < 0 || target >= list.length) return;
    const reordered = [...list];
    const [moved] = reordered.splice(index, 1);
    if (!moved) return;
    reordered.splice(target, 0, moved);
    // Normalise to a dense 1..N sequence so precedence stays unambiguous.
    reorderMutation.mutate(reordered.map((g, i) => ({ id: g.id, displayOrder: i + 1 })));
  }

  return (
    <div>
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">{t("nav.accessControl")}</div>
          <h1 className="acp-page-title">{t("nav.groups")}</h1>
        </div>
        <button type="button" className="btn-primary btn-sm" onClick={() => setShowCreate(true)}>
          <FontAwesomeIcon icon={faPlus} /> {t("groups.createTitle")}
        </button>
      </div>

      {isLoading ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--c-fg-muted)" }}>{t("groups.loading")}</div>
      ) : (groups as Group[]).length === 0 ? (
        <div className="acp-card acp-empty">{t("groups.empty")}</div>
      ) : (
        <div className="acp-groups-grid">
          {(groups as Group[]).map((g, idx) => {
            const color = g.progression?.badgeColor ?? "var(--c-accent)";
            const total = (groups as Group[]).length;
            return (
              <div key={g.id} className="acp-card acp-group-card">
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div
                      style={{
                        width: 40, height: 40,
                        background: g.icon ? "transparent" : `${color}20`,
                        border: `1px solid ${color}40`,
                        borderRadius: "var(--radius-sm)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 16, color,
                        overflow: "hidden",
                      }}
                    >
                      {g.icon
                        ? <img src={`/uploads/${g.icon}`} alt={g.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        : <FontAwesomeIcon icon={faUsers} />
                      }
                    </div>
                    <div
                      title={t("groups.precedenceTitle")}
                      style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        minWidth: 22, height: 22, padding: "0 6px",
                        borderRadius: 999, fontSize: 12, fontWeight: 800,
                        background: "var(--c-bg-subtle, var(--c-bg))", color: "var(--c-fg-muted)",
                        border: "1px solid var(--c-border)",
                      }}
                    >
                      #{idx + 1}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {g.isSystem && (
                      <span className="acp-badge acp-badge--muted">{t("groups.protected")}</span>
                    )}
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <button
                        type="button"
                        className="btn-ghost btn-xs"
                        title={t("groups.moveUp")}
                        disabled={idx === 0 || reorderMutation.isPending}
                        onClick={() => moveGroup(idx, -1)}
                        style={{ padding: "2px 6px", lineHeight: 1, opacity: idx === 0 ? 0.35 : 1 }}
                      >
                        <FontAwesomeIcon icon={faArrowUp} />
                      </button>
                      <button
                        type="button"
                        className="btn-ghost btn-xs"
                        title={t("groups.moveDown")}
                        disabled={idx === total - 1 || reorderMutation.isPending}
                        onClick={() => moveGroup(idx, 1)}
                        style={{ padding: "2px 6px", lineHeight: 1, opacity: idx === total - 1 ? 0.35 : 1 }}
                      >
                        <FontAwesomeIcon icon={faArrowDown} />
                      </button>
                    </div>
                  </div>
                </div>

                <div style={{ fontSize: 16, fontWeight: 800, color: "var(--c-fg)", marginBottom: 4 }}>
                  {g.name}
                </div>

                <div style={{ display: "flex", gap: 16, fontSize: 13, color: "var(--c-fg-muted)", marginBottom: 4 }}>
                  <span>{t("groups.members", { count: g._count.users })}</span>
                  <span>·</span>
                  <span>{t("groups.permsCount", { count: g._count.permissions })}</span>
                </div>
                <code style={{ fontSize: "0.75rem", color: "var(--c-fg-muted)" }}>{g.key}</code>

                <div style={{ display: "flex", gap: "0.4rem", marginTop: 16, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => setEditPerms(g)}
                  >
                    <FontAwesomeIcon icon={faKey} /> {t("groups.permissions")}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => setEditProgression(g)}
                  >
                    <FontAwesomeIcon icon={faDiagramProject} /> {t("groups.progression")}
                  </button>
                  {/* Edit is available for ALL groups, including protected ones */}
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => setEditGroup(g)}
                    title={t("groups.editTitleHint")}
                  >
                    <FontAwesomeIcon icon={faPencil} />
                  </button>
                  {/* Delete only for non-protected groups */}
                  {!g.isSystem && (
                    <button
                      type="button"
                      className="btn-danger btn-sm"
                      onClick={() => handleDelete(g)}
                    >
                      <FontAwesomeIcon icon={faTrash} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showCreate && (
        <CreateGroupModal
          allPermissions={allPermissions as Permission[]}
          onClose={() => setShowCreate(false)}
          onCreated={() => queryClient.invalidateQueries({ queryKey: ["acp-groups-list"] })}
        />
      )}

      {editGroup && (
        <EditGroupModal
          group={editGroup}
          onClose={() => setEditGroup(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ["acp-groups-list"] })}
        />
      )}

      {editPerms && (
        <PermissionsModal
          group={editPerms}
          allPermissions={allPermissions as Permission[]}
          onClose={() => setEditPerms(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ["acp-groups-list"] })}
        />
      )}

      {editProgression && (
        <ProgressionModal
          group={editProgression}
          onClose={() => setEditProgression(null)}
        />
      )}
    </div>
  );
}

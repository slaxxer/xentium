import { useMemo, useState, type DragEvent, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { faChevronRight, faCircleInfo, faGripVertical, faLock, faMagnifyingGlass, faPlus, faUser, faUsers } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../../components/Icon";
import { api } from "../../../lib/api";
import { apiErrorMessage } from "../../../lib/swal";
import { toast } from "../../../lib/toast";
import type { Permission } from "../../../lib/permissions";
import { DEFAULT_BADGE_COLOR, keysOf, powerOf, reorder, type Group } from "./groups/groupModel";
import { GroupGlyph, PowerMeter } from "./groups/groupParts";
import "./acpSystem.scss";
import "./groups/Groups.scss";

// ACP → Members → Groups: every group as one precedence list. The group at the top
// is the badge a member of several groups wears, so the order is the point of
// the page — drag a row (or focus its handle and use Alt+↑/↓) to change it.
// Everything else about a group lives on its own page (groups/GroupDetailPage).

export function GroupsPage() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const { data: groups = [], isLoading } = useQuery<Group[]>({
    queryKey: ["acp-groups-list"],
    queryFn:  () => api.get("/admin/groups"),
  });
  const { data: allPermissions = [] } = useQuery<Permission[]>({
    queryKey: ["acp-permissions-all"],
    queryFn:  () => api.get("/admin/permissions"),
  });

  const reorderMutation = useMutation({
    mutationFn: (items: { id: string; displayOrder: number }[]) => api.put("/admin/groups/reorder", { items }),
    onSuccess: (fresh) => qc.setQueryData(["acp-groups-list"], fresh),
    onError: (e) => {
      toast.error(apiErrorMessage(e));
      void qc.invalidateQueries({ queryKey: ["acp-groups-list"] });
    },
  });

  /** Optimistic: the row lands where it was dropped, and the server confirms. */
  function move(fromId: string, toId: string) {
    const items = reorder(groups, fromId, toId);
    if (!items) return;
    const byId = new Map(groups.map((g) => [g.id, g]));
    qc.setQueryData(["acp-groups-list"], items.map((i) => ({ ...byId.get(i.id)!, displayOrder: i.displayOrder })));
    reorderMutation.mutate(items);
  }

  const q = query.trim().toLowerCase();
  const rows = groups
    .map((g, idx) => ({ g, rank: idx + 1 }))
    .filter(({ g }) => !q || g.name.toLowerCase().includes(q) || g.key.includes(q));
  // Precedence is the whole list's order; dragging within a filtered subset
  // would reorder groups the admin cannot see.
  const canDrag = !q && !reorderMutation.isPending;

  const stats = useMemo(() => ({
    groups: groups.length,
    memberships: groups.reduce((a, g) => a + g._count.users, 0),
    keys: allPermissions.length,
    admins: groups.filter((g) => keysOf(g).includes("admin.access")).length,
  }), [groups, allPermissions]);

  const onHandleKey = (e: KeyboardEvent, idx: number) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown") || !canDrag) return;
    e.preventDefault();
    const target = groups[idx + (e.key === "ArrowUp" ? -1 : 1)];
    if (target) move(groups[idx]!.id, target.id);
  };

  return (
    <div className="gp-page">
      <div className="pg-head">
        <div>
          <p className="pg-eyebrow">{t("nav.members")}</p>
          <h1 className="pg-title">{t("nav.groups")}</h1>
          <p className="pg-sub">{t("groups.list.sub")}</p>
        </div>
        <div className="gp-head-actions">
          <label className="gp-filter">
            <FontAwesomeIcon icon={faMagnifyingGlass} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("groups.list.filter")} aria-label={t("groups.list.filter")} />
          </label>
          <button type="button" className="btn-primary btn-sm" onClick={() => setCreating(true)}>
            <FontAwesomeIcon icon={faPlus} /> {t("groups.create.button")}
          </button>
        </div>
      </div>

      {creating && (
        <CreateGroupCard
          onCancel={() => setCreating(false)}
          onCreated={(id) => { void qc.invalidateQueries({ queryKey: ["acp-groups-list"] }); navigate(`/admin/groups/${id}`); }}
        />
      )}

      <div className="gp-stats">
        {([
          ["groups", stats.groups, ""],
          ["memberships", stats.memberships, ""],
          ["keys", stats.keys, ""],
          ["admins", stats.admins, stats.admins ? "is-danger" : ""],
        ] as const).map(([k, v, tone]) => (
          <div key={k} className="gp-stat">
            <div className="gp-stat__label">{t(`groups.list.stats.${k}`)}</div>
            <div className={`gp-stat__value ${tone}`}>{v}</div>
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="acp-card acp-empty">{t("groups.loading")}</div>
      ) : (
        <div className="gp-table" role="table" aria-label={t("nav.groups")}>
          <div className="gp-row gp-row--head" role="row">
            <span role="columnheader" />
            <span role="columnheader">#</span>
            <span role="columnheader">{t("groups.list.col.group")}</span>
            <span role="columnheader">{t("groups.list.col.members")}</span>
            <span role="columnheader">{t("groups.list.col.power")}</span>
            <span role="columnheader" className="gp-right">{t("groups.list.col.actions")}</span>
          </div>

          {rows.length === 0 && <div className="gp-empty">{t("groups.list.noMatch")}</div>}

          {rows.map(({ g, rank }) => {
            const color = g.progression?.badgeColor || DEFAULT_BADGE_COLOR;
            const power = powerOf(keysOf(g));
            const idx = rank - 1;
            return (
              <div
                key={g.id}
                role="row"
                className={`gp-row${dragId === g.id ? " is-dragging" : ""}${overId === g.id && dragId !== g.id ? " is-over" : ""}`}
                draggable={canDrag}
                onDragStart={(e: DragEvent) => { e.dataTransfer.effectAllowed = "move"; setDragId(g.id); }}
                onDragOver={(e: DragEvent) => { if (!dragId) return; e.preventDefault(); if (overId !== g.id) setOverId(g.id); }}
                onDragEnd={() => { setDragId(null); setOverId(null); }}
                onDrop={(e: DragEvent) => { e.preventDefault(); if (dragId) move(dragId, g.id); setDragId(null); setOverId(null); }}
              >
                <button
                  type="button"
                  className="gp-handle"
                  disabled={!canDrag}
                  aria-label={t("groups.list.moveHint", { name: g.name })}
                  title={canDrag ? t("groups.list.moveHint", { name: g.name }) : t("groups.list.moveDisabled")}
                  onKeyDown={(e) => onHandleKey(e, idx)}
                >
                  <FontAwesomeIcon icon={faGripVertical} />
                </button>
                <span className="gp-rank">#{rank}</span>
                <span className="gp-name">
                  <GroupGlyph color={color} />
                  <span className="gp-name__main">
                    <span className="gp-name__line">
                      <Link to={`/admin/groups/${g.id}`} className="gp-name__title">{g.name}</Link>
                      <BadgePill color={color} label={g.progression?.badgeLabel || g.name} />
                      {g.isSystem && <span className="gp-protected"><FontAwesomeIcon icon={faLock} /> {t("groups.protected")}</span>}
                    </span>
                    <code className="gp-key">{g.key}</code>
                  </span>
                </span>
                <span className="gp-members">
                  <FontAwesomeIcon icon={faUser} /> {t("groups.memberCount", { count: g._count.users })}
                </span>
                <span className="gp-power">
                  <PowerMeter power={power} />
                  <span className="gp-power__detail">{t("groups.powerDetail", { sensitive: power.sensitive, count: power.total })}</span>
                </span>
                <span className="gp-right">
                  <Link to={`/admin/groups/${g.id}`} className="gp-manage">
                    {t("groups.list.manage")} <FontAwesomeIcon icon={faChevronRight} />
                  </Link>
                </span>
              </div>
            );
          })}
        </div>
      )}

      <p className="gp-foot">
        <FontAwesomeIcon icon={faCircleInfo} /> {t("groups.list.powerNote")}
      </p>
    </div>
  );
}

export function BadgePill({ color, label }: { color: string; label: string }) {
  return (
    <span className="gp-pill" style={{ color, background: `${color}20`, borderColor: `${color}40` }}>{label}</span>
  );
}

function CreateGroupCard({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const { t } = useTranslation("acp");
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  // The key follows the name until the admin edits it — it is permanent, so
  // it should start as the obvious thing.
  const derivedKey = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  const effectiveKey = keyTouched ? key : derivedKey;
  const valid = name.trim().length >= 2 && /^[a-z0-9_-]{2,40}$/.test(effectiveKey);

  const create = useMutation({
    mutationFn: () => api.post("/admin/groups", { name: name.trim(), key: effectiveKey }) as Promise<{ id: string }>,
    onSuccess: (g) => { toast.success(t("groups.create.done", { name: name.trim() })); onCreated(g.id); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  return (
    <form className="gp-create" onSubmit={(e) => { e.preventDefault(); if (valid) create.mutate(); }}>
      <div className="gp-create__icon"><FontAwesomeIcon icon={faUsers} /></div>
      <div className="gp-create__fields">
        <label>
          <span className="gp-label">{t("groups.fields.name")}</span>
          <input className="inp" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t("groups.create.namePlaceholder")} />
        </label>
        <label>
          <span className="gp-label">{t("groups.fields.key")}</span>
          <input className="inp is-mono" value={effectiveKey} onChange={(e) => { setKeyTouched(true); setKey(e.target.value); }} placeholder="vip_members" />
          <span className="gp-hint">{t("groups.fields.keyHint")}</span>
        </label>
      </div>
      <div className="gp-create__actions">
        <button type="button" className="btn-ghost btn-sm" onClick={onCancel}>{t("groups.cancel")}</button>
        <button type="submit" className="btn-primary btn-sm" disabled={!valid || create.isPending}>
          {create.isPending ? t("groups.create.creating") : t("groups.create.button")}
        </button>
      </div>
    </form>
  );
}

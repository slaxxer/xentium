/**
 * ACP → Badges — the award catalogue, and who holds what.
 *
 * ⚠ Its OWN page rather than a tab under Progression, where "badge" already means
 * the ladder rung's label. Three things in this codebase are called a badge and only
 * this one is given; putting it beside the derived kind is how an admin ends up
 * editing the wrong one.
 *
 * Two permissions, two sections: `badge.manage` edits the catalogue, `badge.assign`
 * grants and revokes. Both live inside the ACP, which already requires `admin.access`
 * — these narrow what an admin may do here, they are not a second way in.
 *
 * ⚠ NOT autosaved. Creating and editing a badge happens in a modal with an explicit
 * Save, which is the documented exception (`docs/plugin-acp-autosave.md`): a
 * half-typed key is not a state worth persisting, and granting an award is a
 * deliberate act, not a preference.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTrash, faPencil } from "@fortawesome/free-solid-svg-icons";
import { BADGE_ICON_NAMES, type BadgeIconName, type BadgeMetricInfo, type BadgeRow } from "@nodevo/contracts";
import { api } from "../../../lib/api";
import { toast } from "../../../lib/toast";
import { apiErrorMessage } from "../../../lib/swal";
import { badgeIcon } from "../../../lib/badgeIcons";
import { AcpIcon } from "./acpIcons";
import "./BadgesPage.scss";

/** The mark as the ACP draws it — the same glyph the site draws. */
function Mark({ badge, size = 32 }: { badge: Pick<BadgeRow, "faIcon" | "color">; size?: number }) {
  const icon  = badgeIcon(badge.faIcon);
  const color = badge.color ?? "var(--c-accent)";
  return (
    // ⚠ `fontSize` sits on the BOX and is what sizes the glyph, so one number scales
    // the whole mark — the list draws it at 32 and the modal header at 44.
    <span
      className="bdg-mark"
      style={{ width: size, height: size, fontSize: size * 0.5, "--badge-color": color } as React.CSSProperties}
    >
      {icon ? <FontAwesomeIcon icon={icon} /> : <span className="bdg-mark__dot" />}
    </span>
  );
}

// ── Create / edit ───────────────────────────────────────────────────────────

interface Draft {
  key: string; name: string; description: string;
  faIcon: BadgeIconName | null; color: string; displayOrder: number;
  autoAward: boolean; criteria: Record<string, number>;
}

const EMPTY: Draft = {
  key: "", name: "", description: "", faIcon: "faStar", color: "#f4b942", displayOrder: 100,
  // ⚠ Off. A badge an admin creates is a badge an admin hands out; the give-away case
  // is the commoner one and must not sit behind a switch.
  autoAward: false, criteria: {},
};

function BadgeModal({ badge, onClose }: { badge: BadgeRow | null; onClose: () => void }) {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const isEdit = !!badge;

  const [draft, setDraft] = useState<Draft>(badge
    ? {
        key: badge.key, name: badge.name, description: badge.description ?? "",
        faIcon: (badge.faIcon as BadgeIconName | null) ?? null,
        color: badge.color ?? "#f4b942", displayOrder: badge.displayOrder,
        autoAward: badge.autoAward, criteria: { ...badge.criteria },
      }
    : EMPTY);

  /**
   * What this site can measure, asked at open time.
   *
   * ⚠ From the live registry, so the forum's posts and threads appear only while the
   * forum is enabled. A threshold already stored against a disabled plugin is left
   * alone — it is simply not shown or evaluated until the plugin is back.
   */
  const metrics = useQuery<BadgeMetricInfo[]>({
    queryKey: ["admin-badge-metrics"],
    queryFn:  () => api.get("/admin/badges/metrics"),
  });
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: draft.name,
        description: draft.description || null,
        faIcon: draft.faIcon,
        color: draft.color,
        displayOrder: draft.displayOrder,
        autoAward: draft.autoAward,
        // ⚠ Zeroes are stripped, not stored: a blank field means "not a requirement",
        // and a stored 0 would read as a threshold everybody already meets.
        criteria: Object.fromEntries(
          Object.entries(draft.criteria).filter(([, v]) => Number(v) > 0),
        ),
      };
      if (isEdit) return api.patch(`/admin/badges/${badge!.id}`, body);

      return api.post<BadgeRow>("/admin/badges", { ...body, key: draft.key });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-badges"] });
      toast.success(t(isEdit ? "badges.saved" : "badges.created"));
      onClose();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  // The header mark follows the glyph and colour being edited, live.
  const preview = { faIcon: draft.faIcon, color: draft.color };

  return (
    <div className="acp-modal-overlay" onClick={onClose}>
      <div className="acp-modal bdg-modal" onClick={(e) => e.stopPropagation()}>
        <div className="bdg-modal__head">
          <Mark badge={preview} size={44} />
          <div>
            <h2>{t(isEdit ? "badges.editTitle" : "badges.createTitle")}</h2>
            <p>{draft.name || t("badges.namePreview")}</p>
          </div>
        </div>

        <div className="set-rows">
          <div className="set-row">
            <div>
              <div className="set-row__label">{t("badges.fieldName")}</div>
              <div className="set-row__desc">{t("badges.fieldNameDesc")}</div>
            </div>
            <div className="set-row__control">
              <input className="acp-input" value={draft.name} maxLength={60}
                onChange={(e) => set({ name: e.target.value })} />
            </div>
          </div>

          {/* ⚠ The key is create-only. It is the stable identifier a seed or a plugin
              names, so renaming a badge must never change what it is called by. */}
          <div className="set-row">
            <div>
              <div className="set-row__label">{t("badges.fieldKey")}</div>
              <div className="set-row__desc">{t("badges.fieldKeyDesc")}</div>
            </div>
            <div className="set-row__control">
              <input className="acp-input" value={draft.key} disabled={isEdit} maxLength={40}
                placeholder="early-supporter"
                onChange={(e) => set({ key: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "-") })} />
            </div>
          </div>

          <div className="set-row">
            <div>
              <div className="set-row__label">{t("badges.fieldDescription")}</div>
              <div className="set-row__desc">{t("badges.fieldDescriptionDesc")}</div>
            </div>
            <div className="set-row__control">
              <input className="acp-input" value={draft.description} maxLength={300}
                onChange={(e) => set({ description: e.target.value })} />
            </div>
          </div>

          <div className="set-row">
            <div>
              <div className="set-row__label">{t("badges.fieldColor")}</div>
              <div className="set-row__desc">{t("badges.fieldColorDesc")}</div>
            </div>
            <div className="set-row__control">
              <input type="color" className="bdg-color" value={draft.color}
                onChange={(e) => set({ color: e.target.value })} />
            </div>
          </div>

          <div className="set-row">
            <div>
              <div className="set-row__label">{t("badges.fieldOrder")}</div>
              <div className="set-row__desc">{t("badges.fieldOrderDesc")}</div>
            </div>
            <div className="set-row__control">
              <input className="acp-input" type="number" min={0} max={9999} style={{ width: 110 }}
                value={draft.displayOrder}
                onChange={(e) => set({ displayOrder: Number(e.target.value) })} />
            </div>
          </div>
        </div>

        <div className="set-extra">
          <p className="bdg-section-label">{t("badges.glyphTitle")}</p>
          <p className="bdg-hint">{t("badges.glyphHint")}</p>
          <div className="bdg-glyphs">
            {BADGE_ICON_NAMES.map((n) => {
              const def = badgeIcon(n);
              return (
                <button key={n} type="button"
                  className={`bdg-glyph${draft.faIcon === n ? " is-active" : ""}`}
                  title={n}
                  onClick={() => set({ faIcon: n })}>
                  {def && <FontAwesomeIcon icon={def} />}
                </button>
              );
            })}
          </div>

          {/* ── The reward system, per badge ───────────────────────────────────
              Off by default. On, the badge is granted by the sweep to anyone meeting
              EVERY threshold below; off, it is only ever handed over by an admin. */}
          <p className="bdg-section-label">{t("badges.rewardTitle")}</p>
          <label className="bdg-switch">
            <input type="checkbox" checked={draft.autoAward}
              onChange={(e) => set({ autoAward: e.target.checked })} />
            <span>{t("badges.rewardToggle")}</span>
          </label>
          <p className="bdg-hint">{t("badges.rewardNote")}</p>

          {draft.autoAward && (
            <div className="bdg-criteria">
              {(metrics.data ?? []).map((m) => (
                <label key={m.key} className="bdg-criterion">
                  <span className="bdg-criterion__label">
                    {t(`badges.metric.${m.key}`, { defaultValue: m.label })}
                    {/* ⚠ Say which plugin a metric comes from. An admin needs to know
                        that disabling it stops this threshold counting. */}
                    {m.plugin && <em className="bdg-criterion__from">{m.plugin}</em>}
                  </span>
                  <input className="acp-input" type="number" min={0} placeholder="—"
                    value={draft.criteria[m.key] ?? ""}
                    onChange={(e) => {
                      const n = e.target.value === "" ? 0 : Number(e.target.value);
                      set({ criteria: { ...draft.criteria, [m.key]: n } });
                    }} />
                </label>
              ))}
              {/* ⚠ A badge switched on with nothing filled in is earnable by nobody —
                  say so, rather than let an admin think it is live. */}
              {Object.values(draft.criteria).every((v) => !v) && (
                <p className="bdg-hint bdg-hint--warn">{t("badges.rewardEmpty")}</p>
              )}
            </div>
          )}

        </div>

        <div className="bdg-modal__foot">
          <button type="button" className="btn-ghost" onClick={onClose}>{t("badges.cancel")}</button>
          <button type="button" className="btn-primary"
            disabled={!draft.name || (!isEdit && !draft.key) || save.isPending}
            onClick={() => save.mutate()}>
            {t("badges.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── The page ────────────────────────────────────────────────────────────────

export function BadgesPage() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const [editing, setEditing] = useState<BadgeRow | null>(null);
  const [creating, setCreating] = useState(false);

  const badges = useQuery<BadgeRow[]>({
    queryKey: ["admin-badges"],
    queryFn:  () => api.get("/admin/badges"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/badges/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-badges"] });
      // ⚠ Deleting a badge cascades its awards, so every card cache is stale — not
      // one key. This is the only badge action that can change any user's row.
      void qc.invalidateQueries({ queryKey: ["user-badges"] });
      toast.success(t("badges.deleted"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const rows = badges.data ?? [];

  return (
    <div style={{ maxWidth: 1100 }}>
      <div className="pg-head">
        <div>
          <p className="pg-eyebrow">{t("badges.eyebrow")}</p>
          <h1 className="pg-title">{t("badges.title")}</h1>
          <p className="pg-sub">{t("badges.subtitle")}</p>
        </div>
      </div>

      {/* ⚠ No `.set-layout` here. That grid is `216px 1fr` for a page with a section
          nav down the side; this page has one thing on it since awarding moved to the
          member, and leaving the grid in place squeezed the card into the 216px
          column meant for the nav. */}
      <div className="set-content">
        <section className="set-card">
          <div className="set-card__head">
            <div className="set-card__icon"><AcpIcon name="zap" size={18} /></div>
            <div className="set-card__titles">
              <h3>{t("badges.catalogueTitle")}</h3>
              <p>{t("badges.catalogueSub")}</p>
            </div>
            <button type="button" className="btn-primary btn-sm"
              style={{ marginLeft: "auto" }} onClick={() => setCreating(true)}>
              <AcpIcon name="plus" size={14} /><span>{t("badges.new")}</span>
            </button>
          </div>

          <div className="set-extra">
            {rows.length === 0 && <p className="bdg-hint">{t("badges.empty")}</p>}
            <div className="bdg-list">
              {rows.map((b) => (
                <div key={b.id} className="bdg-row">
                  <Mark badge={b} />
                  <div className="bdg-row__id">
                    <span className="bdg-row__name">{b.name}</span>
                    <span className="bdg-row__key">{b.key}</span>
                  </div>
                  {b.description && <span className="bdg-row__desc">{b.description}</span>}
                  <span className="bdg-row__holders">{t("badges.holdersShort", { count: b.holders ?? 0 })}</span>
                  <button type="button" className="bdg-row__act" title={t("badges.edit")}
                    onClick={() => setEditing(b)}>
                    <FontAwesomeIcon icon={faPencil} />
                  </button>
                  {/* A system badge has no delete: something else expects its key. */}
                  {!b.isSystem && (
                    <button type="button" className="bdg-row__act bdg-row__act--danger" title={t("badges.delete")}
                      onClick={() => remove.mutate(b.id)}>
                      <FontAwesomeIcon icon={faTrash} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
      </section>
      </div>

      {creating && <BadgeModal badge={null} onClose={() => setCreating(false)} />}
      {editing  && <BadgeModal badge={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

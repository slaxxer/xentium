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
import { faTrash, faPencil, faXmark, faUpload } from "@fortawesome/free-solid-svg-icons";
import { BADGE_ICON_NAMES, type BadgeIconName, type BadgeRow } from "@nodevo/contracts";
import { api } from "../../../lib/api";
import { toast } from "../../../lib/toast";
import { apiErrorMessage } from "../../../lib/swal";
import { badgeIcon } from "../../../lib/badgeIcons";
import { AcpIcon } from "./acpIcons";
import "./BadgesPage.scss";

type Section = "catalogue" | "awarding";

/** The mark as the ACP draws it — the same precedence the site uses. */
function Mark({ badge, size = 32 }: { badge: Pick<BadgeRow, "icon" | "faIcon" | "color">; size?: number }) {
  const icon  = badgeIcon(badge.faIcon);
  const color = badge.color ?? "var(--c-accent)";
  return (
    <span className="bdg-mark" style={{ width: size, height: size, "--badge-color": color } as React.CSSProperties}>
      {badge.icon
        ? <img src={badge.icon} alt="" />
        : icon
          ? <FontAwesomeIcon icon={icon} style={{ fontSize: size * 0.5 }} />
          : <span className="bdg-mark__dot" />}
    </span>
  );
}

// ── Create / edit ───────────────────────────────────────────────────────────

interface Draft {
  key: string; name: string; description: string;
  faIcon: BadgeIconName | null; color: string; displayOrder: number;
}

const EMPTY: Draft = { key: "", name: "", description: "", faIcon: "faStar", color: "#f4b942", displayOrder: 100 };

function BadgeModal({ badge, onClose }: { badge: BadgeRow | null; onClose: () => void }) {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const isEdit = !!badge;

  const [draft, setDraft] = useState<Draft>(badge
    ? {
        key: badge.key, name: badge.name, description: badge.description ?? "",
        faIcon: (badge.faIcon as BadgeIconName | null) ?? null,
        color: badge.color ?? "#f4b942", displayOrder: badge.displayOrder,
      }
    : EMPTY);
  const [iconUrl, setIconUrl] = useState<string | null>(badge?.icon ?? null);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: draft.name,
        description: draft.description || null,
        faIcon: draft.faIcon,
        color: draft.color,
        displayOrder: draft.displayOrder,
      };
      return isEdit
        ? api.patch(`/admin/badges/${badge!.id}`, body)
        : api.post("/admin/badges", { ...body, key: draft.key });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-badges"] });
      toast.success(t(isEdit ? "badges.saved" : "badges.created"));
      onClose();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  /**
   * ⚠ The upload needs an id, so it only exists in EDIT. A badge is created first
   * and given its picture second — the alternative is holding a file in memory
   * through a create that may fail, and then owning an orphan if it succeeds
   * halfway.
   */
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return api.post<{ icon: string }>(`/admin/badges/${badge!.id}/icon`, fd);
    },
    onSuccess: (r) => {
      setIconUrl(r.icon);
      void qc.invalidateQueries({ queryKey: ["admin-badges"] });
      toast.success(t("badges.iconSaved"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const dropIcon = useMutation({
    mutationFn: () => api.delete(`/admin/badges/${badge!.id}/icon`),
    onSuccess: () => {
      setIconUrl(null);
      void qc.invalidateQueries({ queryKey: ["admin-badges"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const preview = { icon: iconUrl, faIcon: draft.faIcon, color: draft.color };

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

          {isEdit && (
            <>
              <p className="bdg-section-label">{t("badges.uploadTitle")}</p>
              {/* ⚠ 32×32 is the RULE, not a suggestion — the route refuses anything
                  larger, so the admin is told the number before they pick a file. */}
              <p className="bdg-hint">{t("badges.uploadHint")}</p>
              <div className="bdg-upload">
                <label className="btn-ghost btn-sm">
                  <FontAwesomeIcon icon={faUpload} />
                  <span>{t("badges.chooseFile")}</span>
                  <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); }} />
                </label>
                {iconUrl && (
                  <button type="button" className="btn-ghost btn-sm" onClick={() => dropIcon.mutate()}>
                    <FontAwesomeIcon icon={faXmark} />
                    <span>{t("badges.removeFile")}</span>
                  </button>
                )}
              </div>
            </>
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

// ── Awarding ────────────────────────────────────────────────────────────────

interface Holder { id: string; username: string; avatar: string | null; awardedAt: string; note: string | null }

function Awarding({ badges }: { badges: BadgeRow[] }) {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const [badgeId, setBadgeId] = useState(badges[0]?.id ?? "");
  const [search, setSearch]   = useState("");
  const [note, setNote]       = useState("");

  const holders = useQuery<Holder[]>({
    queryKey: ["badge-holders", badgeId],
    queryFn:  () => api.get(`/admin/badges/${badgeId}/holders`),
    enabled:  !!badgeId,
  });

  /** The ACP's own user search. Only runs once there is something to search for. */
  const found = useQuery<{ data: { id: string; username: string; avatar: string | null }[] }>({
    queryKey: ["badge-user-search", search],
    queryFn:  () => api.get(`/admin/users?search=${encodeURIComponent(search)}&limit=8`),
    enabled:  search.trim().length >= 2,
  });

  const award = useMutation({
    mutationFn: (userId: string) => api.post(`/admin/badges/${badgeId}/award`, { userId, note: note || null }),
    onSuccess: (_r, userId) => {
      void qc.invalidateQueries({ queryKey: ["badge-holders", badgeId] });
      void qc.invalidateQueries({ queryKey: ["admin-badges"] });
      // The card cache is keyed per user, so exactly one key goes stale.
      void qc.invalidateQueries({ queryKey: ["user-badges", userId] });
      setSearch(""); setNote("");
      toast.success(t("badges.awarded"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const revoke = useMutation({
    mutationFn: (userId: string) => api.delete(`/admin/badges/${badgeId}/award/${userId}`),
    onSuccess: (_r, userId) => {
      void qc.invalidateQueries({ queryKey: ["badge-holders", badgeId] });
      void qc.invalidateQueries({ queryKey: ["admin-badges"] });
      void qc.invalidateQueries({ queryKey: ["user-badges", userId] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  if (!badges.length) {
    return (
      <section className="set-card">
        <div className="set-card__head">
          <div className="set-card__icon"><AcpIcon name="userPlus" size={18} /></div>
          <div className="set-card__titles">
            <h3>{t("badges.awardTitle")}</h3>
            <p>{t("badges.awardNoneYet")}</p>
          </div>
        </div>
      </section>
    );
  }

  const held = new Set(holders.data?.map((h) => h.id) ?? []);

  return (
    <section className="set-card">
      <div className="set-card__head">
        <div className="set-card__icon"><AcpIcon name="userPlus" size={18} /></div>
        <div className="set-card__titles">
          <h3>{t("badges.awardTitle")}</h3>
          <p>{t("badges.awardSub")}</p>
        </div>
      </div>

      <div className="set-rows">
        <div className="set-row">
          <div>
            <div className="set-row__label">{t("badges.awardWhich")}</div>
            <div className="set-row__desc">{t("badges.awardWhichDesc")}</div>
          </div>
          <div className="set-row__control">
            <select className="acp-input" value={badgeId} onChange={(e) => setBadgeId(e.target.value)}>
              {badges.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        </div>

        <div className="set-row">
          <div>
            <div className="set-row__label">{t("badges.awardNote")}</div>
            <div className="set-row__desc">{t("badges.awardNoteDesc")}</div>
          </div>
          <div className="set-row__control">
            <input className="acp-input" value={note} maxLength={200}
              placeholder={t("badges.awardNotePlaceholder")}
              onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>

        <div className="set-row">
          <div>
            <div className="set-row__label">{t("badges.awardTo")}</div>
            <div className="set-row__desc">{t("badges.awardToDesc")}</div>
          </div>
          <div className="set-row__control">
            <input className="acp-input" value={search} placeholder={t("badges.awardSearch")}
              onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      {search.trim().length >= 2 && (
        <div className="set-extra">
          <div className="bdg-results">
            {(found.data?.data ?? []).map((u) => (
              <button key={u.id} type="button" className="bdg-result"
                disabled={held.has(u.id) || award.isPending}
                onClick={() => award.mutate(u.id)}>
                <span className="bdg-result__name">{u.username}</span>
                <span className="bdg-result__act">
                  {held.has(u.id) ? t("badges.alreadyHas") : t("badges.grant")}
                </span>
              </button>
            ))}
            {found.isSuccess && (found.data?.data.length ?? 0) === 0 && (
              <p className="bdg-hint">{t("badges.noUsers")}</p>
            )}
          </div>
        </div>
      )}

      <div className="set-extra">
        <p className="bdg-section-label">{t("badges.holders", { count: holders.data?.length ?? 0 })}</p>
        {holders.data?.length
          ? (
            <div className="bdg-holders">
              {holders.data.map((h) => (
                <div key={h.id} className="bdg-holder">
                  <span className="bdg-holder__name">{h.username}</span>
                  {h.note && <span className="bdg-holder__note">{h.note}</span>}
                  <button type="button" className="bdg-holder__revoke" title={t("badges.revoke")}
                    onClick={() => revoke.mutate(h.id)}>
                    <FontAwesomeIcon icon={faXmark} />
                  </button>
                </div>
              ))}
            </div>
          )
          : <p className="bdg-hint">{t("badges.noHolders")}</p>}
      </div>
    </section>
  );
}

// ── The page ────────────────────────────────────────────────────────────────

export function BadgesPage() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const [section, setSection] = useState<Section>("catalogue");
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

      <div className="set-layout">
        <nav className="set-secnav">
          <p className="set-secnav__label">{t("badges.sections")}</p>
          <button className={section === "catalogue" ? "is-active" : ""} onClick={() => setSection("catalogue")}>
            <AcpIcon name="zap" size={16} /><span>{t("badges.secCatalogue")}</span>
          </button>
          <button className={section === "awarding" ? "is-active" : ""} onClick={() => setSection("awarding")}>
            <AcpIcon name="userPlus" size={16} /><span>{t("badges.secAwarding")}</span>
          </button>
        </nav>

        <div className="set-content">
          {section === "catalogue" ? (
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
          ) : (
            <Awarding badges={rows} />
          )}
        </div>
      </div>

      {creating && <BadgeModal badge={null} onClose={() => setCreating(false)} />}
      {editing  && <BadgeModal badge={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

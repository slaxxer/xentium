import { useRef, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { faCircleInfo, faEyeDropper, faImage, faTrash } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../../../components/Icon";
import { Toggle } from "../../../../components/AcpControls";
import { UserAvatar } from "../../../../components/UserAvatar";
import { useAuth } from "../../../../hooks/useAuth";
import { api } from "../../../../lib/api";
import { openDialog } from "../../../../lib/dialog";
import { apiErrorMessage } from "../../../../lib/swal";
import { toast } from "../../../../lib/toast";
import { BADGE_SWATCHES, DEFAULT_BADGE_COLOR, glowShadow, isHexColor, type Group, type ProgressionData } from "./groupModel";
import "../../../../components/RankBadge.scss";
import type { GroupForm } from "./GroupDetailPage";

/** ACP → Settings → Rank display, as the site applies it: anything but "image" is badges. */
function useRankDisplay(): "badge" | "image" | undefined {
  const { data } = useQuery({
    queryKey: ["acp-setting", "groups.rank_display"],
    queryFn: () => api.get<{ value: unknown }>("/admin/settings/groups.rank_display"),
    select: (r) => (r?.value === "image" ? "image" as const : "badge" as const),
  });
  return data;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : 0));

export function IdentityTab({ group, rank, form, setForm, prog, setProg, nameInvalid, onDelete, deleting }: {
  group: Group; rank: number;
  form: GroupForm; setForm: Dispatch<SetStateAction<GroupForm | null>>;
  prog: ProgressionData; setProg: Dispatch<SetStateAction<ProgressionData | null>>;
  nameInvalid: boolean; onDelete: () => void; deleting: boolean;
}) {
  const { t } = useTranslation("acp");
  const { user } = useAuth();
  const patch = (p: Partial<ProgressionData>) => setProg((cur) => cur && { ...cur, ...p });
  const color = prog.badgeColor && isHexColor(prog.badgeColor) ? prog.badgeColor : DEFAULT_BADGE_COLOR;
  const label = prog.badgeLabel || form.name || group.name;
  // The preview shows what members see: the rank image when the site shows images
  // and this group has one, the text badge otherwise.
  const showRankImage = useRankDisplay() === "image" && !!group.rankImage;

  const confirmDelete = async () => {
    const ok = await openDialog({
      kind: "confirm", icon: "warning", danger: true,
      title: t("groups.delete.title", { name: group.name }),
      body: t("groups.delete.body", { count: group._count.users }),
      confirmText: t("groups.delete.confirm"), cancelText: t("groups.cancel"),
    });
    if (ok) onDelete();
  };

  return (
    <div className="gp-grid">
      <section className="gp-card gp-pad">
        <h2 className="gp-section">{t("groups.identity.title")}</h2>

        <label className="gp-field">
          <span className="gp-label">{t("groups.fields.name")}</span>
          <input className={`inp${nameInvalid ? " is-invalid" : ""}`} value={form.name} maxLength={60}
            onChange={(e) => setForm((f) => f && { ...f, name: e.target.value })} />
          {nameInvalid && <span className="gp-hint is-error">{t("groups.fields.nameTooShort")}</span>}
        </label>

        <div className="gp-two">
          <label className="gp-field">
            <span className="gp-label">{t("groups.fields.key")}</span>
            <input className="inp is-mono" value={group.key} disabled />
            <span className="gp-hint">{t("groups.fields.keyPermanent")}</span>
          </label>
          <label className="gp-field">
            <span className="gp-label">{t("groups.fields.badgeLabel")}</span>
            <input className="inp" value={prog.badgeLabel ?? ""} maxLength={40} placeholder={form.name}
              onChange={(e) => patch({ badgeLabel: e.target.value || null })} />
          </label>
        </div>

        <div className="gp-field">
          <span className="gp-label">{t("groups.fields.badgeColor")}</span>
          <ColorRow value={prog.badgeColor ?? ""} fallback={DEFAULT_BADGE_COLOR} onChange={(v) => patch({ badgeColor: v || null })} />
        </div>

        <div className="gp-toggle-row">
          <Toggle on={!!prog.badgeTextShadow} onToggle={() => patch({ badgeTextShadow: !prog.badgeTextShadow })} />
          <div>
            <div className="gp-toggle-row__title">{t("groups.identity.glow")}</div>
            <div className="gp-hint">{t("groups.identity.glowHint")}</div>
          </div>
        </div>
        {prog.badgeTextShadow && (
          <div className="gp-glow">
            {([["badgeShadowX", "X", -20, 20], ["badgeShadowY", "Y", -20, 20], ["badgeShadowBlur", t("groups.identity.blur"), 0, 60]] as const).map(([k, l, lo, hi]) => (
              <label key={k} className="gp-field gp-field--sm">
                <span className="gp-label">{l}</span>
                <input className="inp" type="number" min={lo} max={hi} value={prog[k] ?? 0}
                  onChange={(e) => patch({ [k]: clamp(Number(e.target.value), lo, hi) })} />
              </label>
            ))}
            <div className="gp-field">
              <span className="gp-label">{t("groups.identity.glowColor")}</span>
              {prog.badgeShadowColor
                ? <ColorRow value={prog.badgeShadowColor} fallback={color} onChange={(v) => patch({ badgeShadowColor: v || null })} compact
                    reset={() => patch({ badgeShadowColor: null })} resetLabel={t("groups.identity.glowSameAsBadge")} />
                : <button type="button" className="btn-ghost btn-sm" onClick={() => patch({ badgeShadowColor: color })}>{t("groups.identity.glowCustom")}</button>}
            </div>
          </div>
        )}

        <div className="gp-toggle-row">
          <Toggle on={form.showInTeam} onToggle={() => setForm((f) => f && { ...f, showInTeam: !f.showInTeam })} />
          <div>
            <div className="gp-toggle-row__title">{t("groups.identity.team")}</div>
            <div className="gp-hint">{t("groups.identity.teamHint")}</div>
          </div>
        </div>
      </section>

      <div className="gp-stack">
        <section className="gp-card gp-pad">
          <h2 className="gp-section">{t("groups.identity.preview")}</h2>
          <div className="gp-preview">
            {user && <UserAvatar user={user} size={34} />}
            <div className="gp-preview__main">
              <div className="gp-preview__line">
                <span className="gp-preview__name" style={{ color, textShadow: glowShadow(prog, color) }}>{user?.username ?? t("groups.previewName")}</span>
                {!showRankImage && (
                  <span className="gp-pill" style={{ color, background: `${color}20`, borderColor: `${color}40` }}>{label}</span>
                )}
              </div>
              {/* A rank image goes UNDER the name, as on the profile. */}
              {showRankImage && (
                <img className="xt-rankimg gp-preview__rank" src={`/uploads/${group.rankImage}`} alt={label} title={label} />
              )}
              <div className="gp-hint">{t("groups.identity.previewMeta")}</div>
              <p className="gp-preview__text">{t("groups.identity.previewText")}</p>
            </div>
          </div>
          <p className="gp-note"><FontAwesomeIcon icon={faCircleInfo} /> {t("groups.identity.precedenceNote", { n: rank })}</p>
        </section>

        <RankImageCard group={group} label={label} />

        {!group.isSystem && (
          <section className="gp-card gp-pad gp-danger">
            <h2 className="gp-section">{t("groups.delete.section")}</h2>
            <p className="gp-hint">{t("groups.delete.hint")}</p>
            <button type="button" className="btn-danger btn-sm" disabled={deleting} onClick={confirmDelete}>
              <FontAwesomeIcon icon={faTrash} /> {t("groups.delete.confirm")}
            </button>
          </section>
        )}
      </div>
    </div>
  );
}

/** Swatches, the browser's picker and a hex field — one value, three ways in. */
function ColorRow({ value, fallback, onChange, compact, reset, resetLabel }: {
  value: string; fallback: string; onChange: (v: string) => void;
  compact?: boolean; reset?: () => void; resetLabel?: string;
}) {
  const { t } = useTranslation("acp");
  const picker = isHexColor(value) ? value : fallback;
  return (
    <div className="gp-colors">
      {!compact && BADGE_SWATCHES.map((c) => (
        <button key={c} type="button" className={`gp-swatch${value.toLowerCase() === c ? " is-on" : ""}`}
          style={{ background: c }} aria-label={c} aria-pressed={value.toLowerCase() === c} onClick={() => onChange(c)} />
      ))}
      <label className="gp-swatch gp-swatch--picker" title={t("groups.identity.pickColor")}>
        <FontAwesomeIcon icon={faEyeDropper} />
        <input type="color" value={picker} onChange={(e) => onChange(e.target.value)} aria-label={t("groups.identity.pickColor")} />
      </label>
      <input className={`inp is-mono gp-hex${value && !isHexColor(value) ? " is-invalid" : ""}`} value={value} maxLength={7}
        placeholder={fallback} onChange={(e) => onChange(e.target.value.trim())} />
      {reset && <button type="button" className="btn-ghost btn-sm" onClick={reset}>{resetLabel}</button>}
    </div>
  );
}

/**
 * The group's rank image: shown INSTEAD of its text badge everywhere a member's rank
 * appears, while ACP → Settings → Rank display is "Images". A group without one keeps
 * its badge even then, so images can be rolled out one group at a time.
 */
function RankImageCard({ group, label }: { group: Group; label: string }) {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const mode = useRankDisplay();
  const done = () => {
    void qc.invalidateQueries({ queryKey: ["acp-groups-list"] });
    // What every page reads to swap badges for images.
    void qc.invalidateQueries({ queryKey: ["legend-groups"] });
  };

  const upload = useMutation({
    mutationFn: (file: File) => { const fd = new FormData(); fd.append("file", file); return api.post(`/admin/groups/${group.id}/rank-image`, fd); },
    onSuccess: () => { done(); toast.success(t("groups.rankImage.uploaded")); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/admin/groups/${group.id}/rank-image`),
    onSuccess: () => { done(); toast.success(t("groups.rankImage.removed")); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const busy = upload.isPending || remove.isPending;

  return (
    <section className="gp-card gp-pad">
      <h2 className="gp-section">{t("groups.rankImage.title")}</h2>
      <div className="gp-rankimg">
        {group.rankImage
          ? <img className="xt-rankimg" src={`/uploads/${group.rankImage}`} alt={label} title={label} />
          : <span className="gp-rankimg__empty"><FontAwesomeIcon icon={faImage} /></span>}
        <div className="gp-icon-actions">
          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => input.current?.click()}>
            {group.rankImage ? t("groups.icon.replace") : t("groups.icon.upload")}
          </button>
          {group.rankImage && (
            <button type="button" className="btn-ghost btn-sm gp-danger-text" disabled={busy} onClick={() => remove.mutate()}>
              {t("groups.icon.remove")}
            </button>
          )}
        </div>
      </div>
      <div className="gp-hint">{t("groups.rankImage.hint")}</div>
      {mode === "badge" && (
        <div className="gp-hint gp-rankimg__mode">
          <FontAwesomeIcon icon={faCircleInfo} /> {t("groups.rankImage.badgesActive")}{" "}
          <Link to="/admin/settings">{t("groups.rankImage.openSettings")}</Link>
        </div>
      )}
      <input ref={input} type="file" hidden accept="image/jpeg,image/png,image/gif,image/webp"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload.mutate(f); }} />
    </section>
  );
}


/**
 * ACP → Badges — the award catalogue, and who holds what.
 *
 * ⚠ Its OWN page rather than a tab under Progression, where "badge" already means
 * the ladder rung's label. Three things in this codebase are called a badge and only
 * this one is given; putting it beside the derived kind is how an admin ends up
 * editing the wrong one.
 *
 * Two permissions, two things: `badge.manage` edits the catalogue, `badge.assign`
 * grants and revokes. Both live inside the ACP, which already requires `admin.access`
 * — these narrow what an admin may do here, they are not a second way in.
 *
 * ⚠ The page is organised by HOW a badge is come by, not alphabetically. "Earned
 * automatically" and "handed out by hand" are two different jobs — one is a rule an
 * admin configures once, the other a decision they make per member — and an admin
 * arriving here is doing one of them, not browsing a list.
 *
 * ⚠ NOT autosaved. Creating and editing a badge happens in a modal with an explicit
 * Save, which is the documented exception (`docs/plugin-acp-autosave.md`): a
 * half-typed key is not a state worth persisting, and granting an award is a
 * deliberate act, not a preference.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  parseIconToken,
  type BadgeHolder, type BadgeHolderPreview, type BadgeMetricInfo, type BadgeRow,
} from "@xentium/contracts";
import { api } from "../../../lib/api";
import { toast } from "../../../lib/toast";
import { openDialog } from "../../../lib/dialog";
import { apiErrorMessage } from "../../../lib/swal";
import { TokenIcon } from "../../../components/TokenIcon";
import { IconPicker } from "../../../components/IconPicker";
import { faPencil, faTrash } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../../components/Icon";
import { Toggle, NumberStepper } from "../../../components/AcpControls";
import { AcpIcon } from "./acpIcons";
import "./BadgesPage.scss";
import { uiLocale } from "../../../lib/i18n";

// ── Sorting, filtering, grouping ────────────────────────────────────────────

export type BadgeFilter = "all" | "auto" | "manual";
export type BadgeSort   = "order" | "name" | "holders";

/**
 * What the toolbar is actually for, as a pure function — the page renders whatever
 * this returns.
 *
 * ⚠ `order` re-sorts nothing: the server already answers `displayOrder` then `name`,
 * and re-sorting client-side on `displayOrder` alone would drop that tiebreak and
 * reshuffle two badges at the same order between renders.
 */
export function arrangeBadges(
  rows: BadgeRow[], query: string, filter: BadgeFilter, sort: BadgeSort,
): BadgeRow[] {
  const q = query.trim().toLowerCase();
  const hit = (b: BadgeRow) =>
    !q || b.name.toLowerCase().includes(q) || b.key.toLowerCase().includes(q);

  const kept = rows.filter(hit).filter((b) =>
    filter === "all" ? true : filter === "auto" ? b.autoAward : !b.autoAward);

  if (sort === "order") return kept;
  return [...kept].sort(sort === "name"
    ? (a, b) => a.name.localeCompare(b.name)
    : (a, b) => (b.holders ?? 0) - (a.holders ?? 0));
}

// ── Pieces ──────────────────────────────────────────────────────────────────

/** The mark as the ACP draws it — the same glyph the site draws. */
function Mark({ badge, size = 48 }: { badge: Pick<BadgeRow, "faIcon" | "color">; size?: number }) {
  const icon  = parseIconToken(badge.faIcon);
  const color = badge.color ?? "var(--c-accent)";
  return (
    // ⚠ `fontSize` sits on the BOX and is what sizes the glyph, so one number scales
    // the whole mark — the row draws it at 48, the modal's preview at 76.
    <span
      className="bdg-mark"
      style={{ width: size, height: size, fontSize: size * 0.46, "--badge-color": color } as React.CSSProperties}
    >
      {icon ? <TokenIcon token={badge.faIcon} /> : <span className="bdg-mark__dot" />}
    </span>
  );
}

/**
 * Faces on the holders button.
 *
 * ⚠ Initials when there is no avatar, never a placeholder image: the stack is three
 * 22px circles, and at that size a generic silhouette three times over says less
 * than three letters do.
 */
function AvatarStack({ users }: { users: BadgeHolderPreview[] }) {
  if (users.length === 0) return null;
  return (
    <span className="bdg-stack" aria-hidden>
      {users.map((u) => (
        <span key={u.id} className="bdg-stack__face">
          {u.avatar
            ? <img src={u.avatar} alt="" />
            : <span className="bdg-stack__initial">{u.username.slice(0, 1).toUpperCase()}</span>}
        </span>
      ))}
    </span>
  );
}

// ── Who holds it ────────────────────────────────────────────────────────────

/**
 * The holders panel — a drawer, not a second modal.
 *
 * ⚠ It opens OVER the list rather than replacing it, because an admin auditing
 * awards works down the catalogue: closing this must put them back exactly where
 * they were, not at the top of a re-rendered page.
 *
 * ⚠ Awarding is NOT here. A badge is given to a member, so it is given from the
 * member's own page — this panel takes one back, which is the action that belongs
 * beside the list of who has it.
 */
function HoldersPanel({ badge, onClose }: { badge: BadgeRow; onClose: () => void }) {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();

  const holders = useQuery<BadgeHolder[]>({
    queryKey: ["admin-badge-holders", badge.id],
    queryFn:  () => api.get(`/admin/badges/${badge.id}/holders`),
  });

  const revoke = useMutation({
    mutationFn: (userId: string) => api.delete(`/admin/badges/${badge.id}/award/${userId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-badge-holders", badge.id] });
      // The count on the row, and the badge the member's own cards draw.
      void qc.invalidateQueries({ queryKey: ["admin-badges"] });
      void qc.invalidateQueries({ queryKey: ["user-badges"] });
      toast.success(t("badges.revoked"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const rows  = holders.data ?? [];
  const count = badge.holders ?? rows.length;

  return (
    <div className="bdg-drawer-overlay" onClick={onClose}>
      <aside className="bdg-drawer" onClick={(e) => e.stopPropagation()}
        role="dialog" aria-label={badge.name}>
        <div className="bdg-drawer__head">
          <Mark badge={badge} size={44} />
          <div className="bdg-drawer__id">
            <div className="bdg-drawer__name">{badge.name}</div>
            <div className="bdg-drawer__sub">
              {t("badges.holdersShort", { count })}
              {" · "}
              {t(badge.autoAward ? "badges.wayAuto" : "badges.wayManual")}
            </div>
          </div>
          <button type="button" className="bdg-iconbtn" onClick={onClose}
            title={t("badges.close")} aria-label={t("badges.close")}>
            <AcpIcon name="x" size={14} />
          </button>
        </div>

        <div className="bdg-drawer__body">
          {holders.isLoading && <p className="bdg-hint">{t("badges.holdersLoading")}</p>}
          {rows.map((h) => (
            <div key={h.id} className="bdg-holder">
              <span className="bdg-holder__face">
                {h.avatar
                  ? <img src={h.avatar} alt="" />
                  : <span>{h.username.slice(0, 2).toUpperCase()}</span>}
              </span>
              <div className="bdg-holder__id">
                <div className="bdg-holder__name">{h.username}</div>
                {/* How they came by it, and when. ⚠ `auto` decides the wording, not
                    whether a note is present — an admin may give a badge in silence. */}
                <div className="bdg-holder__meta">
                  {h.auto
                    ? t("badges.heldEarned")
                    : h.note
                      ? t("badges.heldGivenFor", { note: h.note })
                      : t("badges.heldGiven")}
                  {" · "}
                  {new Date(h.awardedAt).toLocaleDateString(uiLocale())}
                </div>
              </div>
              <button type="button" className="bdg-holder__revoke"
                title={t("badges.revoke")} aria-label={t("badges.revoke")}
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(h.id)}>
                <AcpIcon name="x" size={14} />
              </button>
            </div>
          ))}
          {!holders.isLoading && rows.length === 0 && (
            <p className="bdg-hint">{t("badges.noHolders")}</p>
          )}
        </div>

        <div className="bdg-drawer__foot">
          <p>{t("badges.drawerFoot")}</p>
        </div>
      </aside>
    </div>
  );
}

// ── Create / edit ───────────────────────────────────────────────────────────

interface Draft {
  key: string; name: string; description: string;
  faIcon: string | null; color: string; displayOrder: number;
  autoAward: boolean; criteria: Record<string, number>;
}

const EMPTY: Draft = {
  key: "", name: "", description: "", faIcon: "faStar", color: "#f4b942", displayOrder: 100,
  // ⚠ Off. A badge an admin creates is a badge an admin hands out; the give-away case
  // is the commoner one and must not sit behind a switch.
  autoAward: false, criteria: {},
};

/**
 * Starting colours.
 *
 * ⚠ Hex, not tokens, and that is not a violation of the no-hardcoded-values rule: a
 * badge's colour is DATA an admin picks and the database stores, drawn on the SITE
 * where the ACP's palette does not reach. A token here would resolve against the
 * admin panel and travel to visitors as a value that means something else.
 */
const SWATCHES = [
  "#f4b942", "#ef4444", "#23a55a", "#00b1cf",
  "#5865f2", "#a855f7", "#f4a259", "#5b5e74",
];

type Tab = "details" | "appearance" | "reward";

/** Which glyph stands for a core metric. Unknown keys (a plugin's) get the default. */
const METRIC_ICONS: Record<string, string> = {
  articles: "file", comments: "forum", likes: "heart", followers: "users",
};

function BadgeModal({ badge, onClose }: { badge: BadgeRow | null; onClose: () => void }) {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const isEdit = !!badge;

  const [tab, setTab] = useState<Tab>("details");
  const [draft, setDraft] = useState<Draft>(badge
    ? {
        key: badge.key, name: badge.name, description: badge.description ?? "",
        faIcon: badge.faIcon ?? null,
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
      // The glyph, colour and name a card draws all live on the badge itself.
      void qc.invalidateQueries({ queryKey: ["user-badges"] });
      toast.success(t(isEdit ? "badges.saved" : "badges.created"));
      onClose();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  /** The thresholds actually asked for — what decides whether this is earnable. */
  const asked = Object.entries(draft.criteria).filter(([, v]) => Number(v) > 0);
  const unitFor = (m: BadgeMetricInfo) =>
    t(`badges.unit.${m.key}`, { defaultValue: t(`badges.metric.${m.key}`, { defaultValue: m.label }).toLowerCase() });
  const named = (key: string) => {
    const m = (metrics.data ?? []).find((x) => x.key === key);
    return m ? unitFor(m) : key;
  };

  const tabs: { id: Tab; icon: string; mark?: string }[] = [
    { id: "details",    icon: "sliders" },
    { id: "appearance", icon: "palette" },
    { id: "reward",     icon: "zap", mark: draft.autoAward ? t("badges.on") : undefined },
  ];

  return (
    <div className="acp-modal-overlay" onClick={onClose}>
      <div className="acp-modal bdg-modal" onClick={(e) => e.stopPropagation()}>
        {/* ── The rail: what you are making, and which part of it ──────────── */}
        <aside className="bdg-modal__rail">
          {/* ⚠ A live preview, not an illustration. Colour and glyph are chosen two
              tabs apart, and their result is the one thing an admin actually judges. */}
          <div className="bdg-preview">
            <Mark badge={{ faIcon: draft.faIcon, color: draft.color }} size={76} />
            <div className="bdg-preview__id">
              <div className={`bdg-preview__name${draft.name ? "" : " is-empty"}`}>
                {draft.name || t("badges.namePreview")}
              </div>
              <code>{draft.key || t("badges.keyPreview")}</code>
            </div>
          </div>

          <nav className="bdg-tabs">
            {tabs.map((x) => (
              <button key={x.id} type="button"
                className={`bdg-tab${tab === x.id ? " is-on" : ""}`}
                onClick={() => setTab(x.id)}>
                <AcpIcon name={x.icon} size={16} />
                <span>{t(`badges.tab.${x.id}`)}</span>
                {x.mark && <em className="bdg-tab__mark">{x.mark}</em>}
              </button>
            ))}
          </nav>

          <p className="bdg-modal__note">
            {isEdit
              ? t("badges.railHolders", { count: badge!.holders ?? 0 })
              : t("badges.railNew")}
          </p>
        </aside>

        {/* ── The pane ─────────────────────────────────────────────────────── */}
        <div className="bdg-modal__pane">
          <div className="bdg-modal__head">
            <div>
              <h2>{t(`badges.pane.${tab}`)}</h2>
              <p>{t(`badges.paneNote.${tab}`)}</p>
            </div>
            <button type="button" className="bdg-iconbtn" onClick={onClose}
              title={t("badges.close")} aria-label={t("badges.close")}>
              <AcpIcon name="x" size={14} />
            </button>
          </div>

          <div className="bdg-modal__body">
            {tab === "details" && (
              <div className="set-rows bdg-rows">
                <div className="set-row">
                  <div>
                    <div className="set-row__label">{t("badges.fieldName")}</div>
                    <div className="set-row__desc">{t("badges.fieldNameDesc")}</div>
                  </div>
                  <div className="set-row__control">
                    <input className="inp" value={draft.name} maxLength={60}
                      placeholder={t("badges.namePlaceholder")}
                      onChange={(e) => set({ name: e.target.value })} />
                  </div>
                </div>

                {/* ⚠ The key is create-only. It is the stable identifier a seed or a
                    plugin names, so renaming a badge must never change what it is
                    called by. */}
                <div className="set-row">
                  <div>
                    <div className="set-row__label">{t("badges.fieldKey")}</div>
                    <div className="set-row__desc">{t("badges.fieldKeyDesc")}</div>
                  </div>
                  <div className="set-row__control">
                    <input className="inp bdg-mono" value={draft.key} disabled={isEdit} maxLength={40}
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
                    <input className="inp" value={draft.description} maxLength={300}
                      placeholder={t("badges.descPlaceholder")}
                      onChange={(e) => set({ description: e.target.value })} />
                  </div>
                </div>

                <div className="set-row">
                  <div>
                    <div className="set-row__label">{t("badges.fieldOrder")}</div>
                    <div className="set-row__desc">{t("badges.fieldOrderDesc")}</div>
                  </div>
                  <div className="set-row__control">
                    <NumberStepper value={draft.displayOrder} min={0} max={9999} step={10}
                      onChange={(v) => set({ displayOrder: v })} />
                  </div>
                </div>
              </div>
            )}

            {tab === "appearance" && (
              <div className="bdg-appearance">
                <div className="bdg-block">
                  <div className="set-row__label">{t("badges.fieldColor")}</div>
                  <div className="set-row__desc">{t("badges.fieldColorDesc")}</div>
                  <div className="bdg-swatches">
                    {SWATCHES.map((c) => (
                      <button key={c} type="button" title={c}
                        className={`bdg-swatch${draft.color.toLowerCase() === c ? " is-on" : ""}`}
                        style={{ background: c }}
                        aria-label={c} aria-pressed={draft.color.toLowerCase() === c}
                        onClick={() => set({ color: c })} />
                    ))}
                    <span className="bdg-swatches__sep" />
                    {/* The swatches are a starting point, not the whole range. */}
                    <label className="bdg-custom">
                      <input type="color" value={draft.color}
                        onChange={(e) => set({ color: e.target.value })} />
                      <span>{draft.color}</span>
                    </label>
                  </div>
                </div>

                <div className="bdg-block">
                  <div className="set-row__label">{t("badges.glyphTitle")}</div>
                  <div className="set-row__desc">{t("badges.glyphHint")}</div>
                  {/* ⚠ The shared picker, not a glyph grid of this page's own: it is
                      the one surface that knows about the site's icon kit, pinned
                      styles and the bundled fallback. It also reads the LEGACY
                      `faStar` values badges already store and writes tokens back, so
                      no migration is needed over rows an admin may have hand-edited. */}
                  <IconPicker value={draft.faIcon} onChange={(tok) => set({ faIcon: tok })} />
                </div>
              </div>
            )}

            {tab === "reward" && (
              <div className="bdg-reward">
                <div className={`acp-banner${draft.autoAward ? " is-on" : ""}`}>
                  <span className="acp-banner__icon"><AcpIcon name="zap" size={16} /></span>
                  <div>
                    <div className="acp-banner__title">{t("badges.rewardToggle")}</div>
                    <div className="acp-banner__desc">
                      {t(draft.autoAward ? "badges.rewardOn" : "badges.rewardOff")}
                    </div>
                  </div>
                  <Toggle on={draft.autoAward} onToggle={() => set({ autoAward: !draft.autoAward })} />
                </div>

                {draft.autoAward && (
                  <>
                    <div className="bdg-reward__head">
                      <div className="set-row__label">{t("badges.requirements")}</div>
                      <div className="set-row__desc">{t("badges.requirementsNote")}</div>
                    </div>

                    <div className="bdg-criteria">
                      {(metrics.data ?? []).map((m) => {
                        const on = Number(draft.criteria[m.key]) > 0;
                        return (
                          <label key={m.key} className={`bdg-criterion${on ? " is-on" : ""}`}>
                            <span className="bdg-criterion__ic">
                              <AcpIcon name={METRIC_ICONS[m.key] ?? "activity"} size={15} />
                            </span>
                            <span className="bdg-criterion__label">
                              {t(`badges.metric.${m.key}`, { defaultValue: m.label })}
                              {/* ⚠ Say which plugin a metric comes from. An admin needs
                                  to know that disabling it stops this threshold
                                  counting. */}
                              {m.plugin && <em className="bdg-criterion__from">{m.plugin}</em>}
                            </span>
                            <input className="inp inp--sm bdg-criterion__val" type="number" min={0}
                              placeholder="—"
                              value={draft.criteria[m.key] ?? ""}
                              onChange={(e) => {
                                const n = e.target.value === "" ? 0 : Number(e.target.value);
                                set({ criteria: { ...draft.criteria, [m.key]: n } });
                              }} />
                            <span className="bdg-criterion__unit">{unitFor(m)}</span>
                          </label>
                        );
                      })}
                    </div>

                    {/* ⚠ A badge switched on with nothing filled in is earnable by
                        nobody — say so, rather than let an admin think it is live. */}
                    <p className={`bdg-summary${asked.length === 0 ? " is-warn" : ""}`}>
                      {asked.length === 0
                        ? t("badges.rewardEmpty")
                        : t("badges.rewardSummary", {
                            list: asked.map(([k, v]) => `${v} ${named(k)}`).join(t("badges.and")),
                          })}
                    </p>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="bdg-modal__foot">
            <span>{t(isEdit ? "badges.footEdit" : "badges.footNew")}</span>
            <button type="button" className="btn-ghost" onClick={onClose}>{t("badges.cancel")}</button>
            <button type="button" className="btn-primary"
              disabled={!draft.name || (!isEdit && !draft.key) || save.isPending}
              onClick={() => save.mutate()}>
              {t(isEdit ? "badges.save" : "badges.create")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── The page ────────────────────────────────────────────────────────────────

export function BadgesPage() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const [editing, setEditing]   = useState<BadgeRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [holdersFor, setHoldersFor] = useState<string | null>(null);

  const [query, setQuery]   = useState("");
  const [filter, setFilter] = useState<BadgeFilter>("all");
  const [sort, setSort]     = useState<BadgeSort>("order");

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

  /**
   * ⚠ Deleting asks first. It takes every award of the badge with it (the awards
   * cascade), so an admin tidying the catalogue can quietly undo work that was
   * handed out one member at a time — and nothing here can put it back.
   */
  const askThenDelete = async (b: BadgeRow) => {
    const held = b.holders ?? 0;
    const ok = await openDialog({
      kind: "confirm", icon: "warning", danger: true,
      title: t("badges.deleteTitle", { name: b.name }),
      // ⚠ Nobody holds it → say THAT, rather than "0 members hold it. Deleting takes
      // every one of those awards with it", which is what a plural alone produces.
      body:  held === 0 ? t("badges.deleteBodyNone") : t("badges.deleteBody", { count: held }),
      confirmText: t("badges.delete"),
      cancelText:  t("badges.cancel"),
    });
    if (ok) remove.mutate(b.id);
  };

  const rows = badges.data ?? [];
  const shown = useMemo(() => arrangeBadges(rows, query, filter, sort), [rows, query, filter, sort]);

  const awarded = rows.reduce((n, b) => n + (b.holders ?? 0), 0);
  const panel   = rows.find((b) => b.id === holdersFor) ?? null;

  /**
   * ⚠ The filter HIDES a group rather than emptying it. "By hand" showing an empty
   * state because the admin filtered to Automatic explains nothing — the group is not
   * empty, it is excluded, and only the group that is actually empty should say so.
   */
  const groups = [
    { id: "auto" as const, icon: "zap", rows: shown.filter((b) => b.autoAward) },
    { id: "manual" as const, icon: "hand", rows: shown.filter((b) => !b.autoAward) },
  ].filter((g) => filter === "all" || filter === g.id);

  /** With a search running, an empty group means "no match", not "make one". */
  const searching = query.trim() !== "";

  return (
    // The class is only a scope for this page's narrow rules — `.pg-head` is shared
    // by every ACP page, and this one is the only one with a stats pill beside it.
    <div className="bdg-page" style={{ maxWidth: 1100 }}>
      <div className="pg-head">
        <div>
          <p className="pg-eyebrow">{t("badges.eyebrow")}</p>
          <h1 className="pg-title">{t("badges.title")}</h1>
          <p className="pg-sub">{t("badges.subtitle")}</p>
        </div>

        <div className="bdg-headside">
          {/* What the catalogue amounts to: how many badges exist, and how many
              awards are actually out there. */}
          <div className="bdg-stats">
            <span><b>{rows.length}</b> {t("badges.statBadges")}</span>
            <i />
            <span><b>{awarded}</b> {t("badges.statAwarded")}</span>
          </div>
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
            <AcpIcon name="plus" size={15} /><span>{t("badges.new")}</span>
          </button>
        </div>
      </div>

      {/* ⚠ No `.set-layout`/`.set-card` here. That grid is `216px 1fr` for a page with
          a section nav down the side, and this page's content is a list of badges —
          wrapping it in a settings card put a card inside a card. The header, tokens
          and controls are still core's, so it reads as the same panel. */}
      <div className="bdg-toolbar">
        <div className="bdg-search">
          <AcpIcon name="search" size={15} />
          <input className="inp inp--sm" value={query}
            placeholder={t("badges.searchPlaceholder")}
            onChange={(e) => setQuery(e.target.value)} />
        </div>

        <div className="acp-seg acp-seg--auto">
          {(["all", "auto", "manual"] as BadgeFilter[]).map((f) => (
            <button key={f} type="button" className={filter === f ? "is-on" : ""}
              onClick={() => setFilter(f)}>{t(`badges.filter.${f}`)}</button>
          ))}
        </div>

        <div className="bdg-toolbar__sort">
          <span>{t("badges.sort")}</span>
          <div className="acp-seg acp-seg--auto">
            {(["order", "name", "holders"] as BadgeSort[]).map((s) => (
              <button key={s} type="button" className={sort === s ? "is-on" : ""}
                onClick={() => setSort(s)}>{t(`badges.sortBy.${s}`)}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="bdg-groups">
        {groups.map((g) => (
          <section key={g.id} className="bdg-group">
            <div className="bdg-group__head">
              <div className={`bdg-group__icon is-${g.id}`}><AcpIcon name={g.icon} size={16} /></div>
              <div>
                <div className="bdg-group__titles">
                  <h2>{t(`badges.group.${g.id}`)}</h2>
                  <span className="bdg-group__count">{g.rows.length}</span>
                </div>
                <p>{t(`badges.groupNote.${g.id}`)}</p>
              </div>
            </div>

            <div className="bdg-list">
              {g.rows.map((b) => (
                <div key={b.id} className="bdg-row">
                  <Mark badge={b} />

                  <div className="bdg-row__id">
                    <div className="bdg-row__top">
                      <span className="bdg-row__name">{b.name}</span>
                      <code className="bdg-row__key">{b.key}</code>
                      {/* A system badge is seeded and something expects its key. */}
                      {b.isSystem && <span className="bdg-row__system">{t("badges.system")}</span>}
                    </div>
                    {/* ⚠ What the row says under the name depends on how the badge is
                        come by: for an automatic one the thresholds ARE the badge, and
                        its description is the least useful thing to show. */}
                    <p className="bdg-row__sub">
                      {b.autoAward
                        ? Object.keys(b.criteria).length === 0
                          ? t("badges.rewardEmptyShort")
                          : t("badges.autoSub", {
                              list: Object.entries(b.criteria).map(([k, v]) =>
                                `${v} ${t(`badges.unit.${k}`, {
                                  defaultValue: t(`badges.metric.${k}`, { defaultValue: k }).toLowerCase(),
                                })}`).join(", "),
                            })
                        : b.description || t("badges.noDescription")}
                    </p>
                  </div>

                  <button type="button" className="bdg-row__holders"
                    title={t("badges.showHolders")} onClick={() => setHoldersFor(b.id)}>
                    <AvatarStack users={b.holderPreview ?? []} />
                    <span>{t("badges.holdersShort", { count: b.holders ?? 0 })}</span>
                    <AcpIcon name="arrowRight" size={14} />
                  </button>

                  <div className="bdg-row__acts">
                    <button type="button" className="bdg-iconbtn" title={t("badges.edit")}
                      aria-label={t("badges.edit")} onClick={() => setEditing(b)}>
                      <FontAwesomeIcon icon={faPencil} />
                    </button>
                    {!b.isSystem && (
                      <button type="button" className="bdg-iconbtn bdg-iconbtn--danger"
                        title={t("badges.delete")} aria-label={t("badges.delete")}
                        onClick={() => void askThenDelete(b)}>
                        <FontAwesomeIcon icon={faTrash} />
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {g.rows.length === 0 && (
                <div className="bdg-empty">
                  <div>
                    <div className="bdg-empty__title">
                      {t(searching ? "badges.emptyFiltered" : `badges.empty.${g.id}`)}
                    </div>
                    {!searching && <p>{t(`badges.emptyNote.${g.id}`)}</p>}
                  </div>
                  {!searching && (
                    <button type="button" className="bdg-empty__act" onClick={() => setCreating(true)}>
                      <AcpIcon name="plus" size={12} />
                      <span>{t(`badges.emptyAct.${g.id}`)}</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>
        ))}
      </div>

      {panel && <HoldersPanel badge={panel} onClose={() => setHoldersFor(null)} />}
      {creating && <BadgeModal badge={null} onClose={() => setCreating(false)} />}
      {editing  && <BadgeModal badge={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

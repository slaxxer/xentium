import { useMemo, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { FontAwesomeIcon } from "../../../components/Icon";
import { faPlus, faTrash, faGripVertical, faLock, faXmark } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { toast } from "../../../lib/toast";
import { openDialog } from "../../../lib/dialog";
import { apiErrorMessage } from "../../../lib/swal";
import { sameValue } from "../../../hooks/useAutosave";
import { useDraft } from "../../../hooks/useDraft";
import { Toggle, NumberStepper, Button } from "../../../components/AcpControls";
import { fieldLabel } from "../../../lib/coreText";
import "./ProfileFieldsPage.scss";

/**
 * ACP · Members · Profile Fields: what members can tell about themselves.
 *
 * The fields in profile order on the left (drag to reorder, which saves at once),
 * the open one's settings on the right. Every field's edits sit in ONE map draft
 * on the save bar, so switching fields is not leaving. Creating and deleting are
 * explicit actions, not drafts.
 */

const TYPES = ["text", "longtext", "date", "email", "url", "choice"] as const;
type FieldType = (typeof TYPES)[number];
type Signup = "off" | "optional" | "required";
type Privacy = "public" | "members" | "nobody";
type DobFormat = "age" | "birthday" | "full";

interface ProfileField {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  placeholder: string | null;
  helpText: string | null;
  showOnRegistration: boolean;
  requiredOnRegistration: boolean;
  showOnProfile: boolean;
  isSystem: boolean;
  position: number;
  dobDisplayFormat: DobFormat | null;
  defaultPrivacy: Privacy;
  minAge: number;
  maxLength: number | null;
  linkPrefix: string | null;
  options: string[] | null;
}

interface Stats { members: number; filled: Record<string, number> }

/** What the editor holds for one field. Numbers stay text while being typed. */
interface Draft {
  label: string;
  type: FieldType;
  placeholder: string;
  helpText: string;
  signup: Signup;
  showOnProfile: boolean;
  defaultPrivacy: Privacy;
  dobDisplayFormat: DobFormat;
  minAge: number;
  maxLength: string;
  linkPrefix: string;
  options: string[];
}

/** The longest answer each type takes without a limit of its own (as the server). */
const TYPE_MAX: Record<FieldType, number> = { text: 255, longtext: 2000, date: 10, email: 254, url: 500, choice: 80 };
const TYPE_SHORT: Record<FieldType, string> = { text: "Aa", longtext: "¶", date: "31", email: "@", url: "↗", choice: "≡" };

const KEY = ["admin-profile-fields"];
const STATS_KEY = ["admin-profile-fields", "stats"];

function draftOf(f: ProfileField): Draft {
  return {
    label: f.label,
    type: f.type,
    placeholder: f.placeholder ?? "",
    helpText: f.helpText ?? "",
    signup: f.requiredOnRegistration ? "required" : f.showOnRegistration ? "optional" : "off",
    showOnProfile: f.showOnProfile,
    defaultPrivacy: f.defaultPrivacy,
    dobDisplayFormat: f.dobDisplayFormat ?? "age",
    minAge: f.minAge,
    maxLength: f.maxLength ? String(f.maxLength) : "",
    linkPrefix: f.linkPrefix ?? "",
    options: f.options ?? [],
  };
}

/** What a draft sends: only what applies to its type, tidied as the server stores it. */
function payloadOf(d: Draft, f: ProfileField) {
  const isDob = f.key === "date_of_birth";
  const len = Number(d.maxLength);
  return {
    label: d.label.trim(),
    ...(f.isSystem ? {} : { type: d.type }),
    placeholder: d.placeholder.trim() || null,
    helpText: d.helpText.trim() || null,
    showOnRegistration: d.signup !== "off",
    requiredOnRegistration: d.signup === "required",
    showOnProfile: d.showOnProfile,
    defaultPrivacy: d.defaultPrivacy,
    ...(d.type === "date" ? { dobDisplayFormat: d.dobDisplayFormat } : {}),
    ...(isDob ? { minAge: d.minAge } : {}),
    ...(d.type === "text" || d.type === "longtext"
      ? { maxLength: Number.isInteger(len) && len > 0 ? Math.min(len, 5000) : null } : {}),
    ...(d.type === "text" ? { linkPrefix: d.linkPrefix.trim() || null } : {}),
    ...(d.type === "choice" ? { options: d.options.map((o) => o.trim()).filter(Boolean) } : {}),
  };
}

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\w\s]/g, "").trim().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "").slice(0, 40);

export function ProfileFieldsPage() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const selected = params.get("field");
  const pick = (id: string) => setParams((p) => { p.set("field", id); return p; }, { replace: true });

  const { data: fields = [], isLoading } = useQuery<ProfileField[]>({ queryKey: KEY, queryFn: () => api.get("/admin/profile-fields") });
  const { data: stats } = useQuery<Stats>({ queryKey: STATS_KEY, queryFn: () => api.get("/admin/profile-fields/stats") });

  // ── The draft: every edited field, by id ──────────────────────────────────
  const [edits, setEdits] = useState<Record<string, Draft>>({});
  const byId = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);
  const saved = useMemo(() => {
    if (isLoading) return undefined;
    return Object.fromEntries(Object.keys(edits).flatMap((id) => {
      const f = byId.get(id);
      return f ? [[id, payloadOf(draftOf(f), f)]] : [];
    }));
  }, [isLoading, edits, byId]);
  const sent = Object.fromEntries(Object.entries(edits).flatMap(([id, d]) => {
    const f = byId.get(id);
    return f ? [[id, payloadOf(d, f)]] : [];
  }));
  const dropEdit = (id: string) => setEdits((p) => { const { [id]: _gone, ...rest } = p; return rest; });

  const saveAll = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map((id) => api.patch<ProfileField>(`/admin/profile-fields/${id}`, sent[id]))),
    onSuccess: (rows) => {
      qc.setQueryData<ProfileField[]>(KEY, (old) => (old ?? []).map((f) => rows.find((r) => r.id === f.id) ?? f));
      setEdits((p) => Object.fromEntries(Object.entries(p).filter(([id]) => !rows.some((r) => r.id === id))));
    },
  });

  useDraft({
    value: sent,
    savedValue: saved,
    onSave: () => {
      const changed = Object.keys(sent).filter((id) => saved?.[id] && !sameValue(sent[id], saved[id]));
      return changed.length ? saveAll.mutateAsync(changed) : undefined;
    },
    onDiscard: () => setEdits({}),
    describe: (value, base) => Object.keys(value)
      .filter((id) => !sameValue(value[id], base[id]))
      .map((id) => ({
        key: id,
        label: edits[id]?.label || t("profileFields.untitled"),
        section: t("profileFields.title"),
        from: t("profileFields.changeFrom"),
        to: t("profileFields.changeTo"),
        revert: () => dropEdit(id),
      })),
  });

  const view = (f: ProfileField): Draft => edits[f.id] ?? draftOf(f);
  const current = fields.find((f) => f.id === selected) ?? fields[0] ?? null;
  const setDraft = (patch: Partial<Draft>) => {
    if (!current) return;
    setEdits((p) => ({ ...p, [current.id]: { ...view(current), ...patch } }));
  };

  // ── Order: saves at once ──────────────────────────────────────────────────
  const [dragId, setDragId] = useState<string | null>(null);
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.put("/admin/profile-fields/reorder", { items: ids.map((id, i) => ({ id, position: i + 1 })) }),
    onError: (e) => { toast.error(apiErrorMessage(e)); void qc.invalidateQueries({ queryKey: KEY }); },
  });
  function drop(from: string, to: string) {
    if (from === to) return;
    const ids = fields.map((f) => f.id);
    const i = ids.indexOf(from), j = ids.indexOf(to);
    if (i < 0 || j < 0) return;
    ids.splice(i, 1);
    ids.splice(j, 0, from);
    qc.setQueryData<ProfileField[]>(KEY, ids.map((id) => byId.get(id)!).filter(Boolean));
    reorder.mutate(ids);
  }

  // ── Create and delete: explicit ───────────────────────────────────────────
  const [adding, setAdding] = useState(false);
  const create = useMutation({
    mutationFn: (body: { key: string; label: string; type: FieldType }) =>
      api.post<ProfileField>("/admin/profile-fields", {
        ...body,
        showOnProfile: true,
        ...(body.type === "choice" ? { options: [t("profileFields.optionN", { n: 1 }), t("profileFields.optionN", { n: 2 })] } : {}),
      }),
    onSuccess: (row) => {
      qc.setQueryData<ProfileField[]>(KEY, (old) => [...(old ?? []), row]);
      void qc.invalidateQueries({ queryKey: STATS_KEY });
      setAdding(false);
      pick(row.id);
      toast.success(t("profileFields.created"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/profile-fields/${id}`),
    onSuccess: (_r, id) => {
      dropEdit(id);
      qc.setQueryData<ProfileField[]>(KEY, (old) => (old ?? []).filter((f) => f.id !== id));
      void qc.invalidateQueries({ queryKey: STATS_KEY });
      setParams((p) => { p.delete("field"); return p; }, { replace: true });
      toast.success(t("profileFields.deleted"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  async function confirmDelete(f: ProfileField) {
    const ok = await openDialog({
      kind: "confirm", icon: "warning",
      title: t("profileFields.deleteConfirmTitle", { label: fieldLabel(f) }),
      body: t("profileFields.deleteConfirmBody", { count: answered(f.id) }),
      confirmText: t("profileFields.deleteConfirmBtn"),
      cancelText: t("common:actions.cancel"),
    });
    if (ok) remove.mutate(f.id);
  }

  // ── Figures ───────────────────────────────────────────────────────────────
  const answered = (id: string) => stats?.filled[id] ?? 0;
  const percent = (id: string) => (stats && stats.members > 0 ? Math.round((answered(id) / stats.members) * 100) : 0);
  const drafts = fields.map((f) => ({ f, d: view(f) }));
  const atSignup = drafts.filter(({ d }) => d.signup !== "off").length;
  const required = drafts.filter(({ d }) => d.signup === "required").length;
  const top = stats ? [...fields].sort((a, b) => answered(b.id) - answered(a.id))[0] : undefined;

  const d = current ? view(current) : null;
  const typeLocked = !!current && (current.isSystem || answered(current.id) > 0);

  return (
    <div className="pfp">
      <div className="pg-head">
        <div>
          <p className="pg-eyebrow">{t("profileFields.eyebrow")}</p>
          <h1 className="pg-title">{t("profileFields.title")}</h1>
          <p className="pg-sub">{t("profileFields.sub")}</p>
        </div>
        <Button className="pfp-add" onClick={() => setAdding(true)} disabled={adding}>
          <FontAwesomeIcon icon={faPlus} /> {t("profileFields.addField")}
        </Button>
      </div>

      <section className="pfp-stats" aria-label={t("profileFields.overview")}>
        <Stat value={fields.length} label={t("profileFields.statFields")} sub={t("profileFields.statFieldsSub", { count: fields.filter((f) => f.isSystem).length })} />
        <Stat value={atSignup} label={t("profileFields.statSignup")} sub={required ? t("profileFields.statSignupRequired", { count: required }) : t("profileFields.statSignupNone")} />
        <Stat value={drafts.filter(({ d: x }) => x.showOnProfile).length} label={t("profileFields.statProfile")} sub={t("profileFields.statProfileSub")} />
        <Stat
          value={top && answered(top.id) > 0 ? `${percent(top.id)}%` : "–"}
          label={t("profileFields.statTop")}
          sub={top && answered(top.id) > 0 ? fieldLabel(view(top).label === top.label ? top : { ...top, label: view(top).label }) : t("profileFields.statTopNone")}
        />
      </section>

      {isLoading && <p className="pfp-muted">{t("profileFields.loading")}</p>}

      <div className="pfp-split">
        <section className="pfp-list" aria-label={t("profileFields.title")}>
          <div className="pfp-list__bar">
            <span className="pfp-caps">{t("profileFields.listCaps")}</span>
            <span className="pfp-muted">{t("profileFields.dragHint")}</span>
          </div>

          {adding && <NewField busy={create.isPending} taken={new Set(fields.map((f) => f.key))}
            onCancel={() => setAdding(false)} onCreate={(body) => create.mutate(body)} />}

          <div className="pfp-rows">
            {drafts.map(({ f, d: x }) => {
              const on = current?.id === f.id;
              return (
                <div
                  key={f.id}
                  className={`pfp-row${on ? " is-on" : ""}${dragId === f.id ? " is-dragging" : ""}`}
                  draggable
                  onDragStart={(e: DragEvent) => { e.dataTransfer.effectAllowed = "move"; setDragId(f.id); }}
                  onDragOver={(e: DragEvent) => e.preventDefault()}
                  onDrop={(e: DragEvent) => { e.preventDefault(); if (dragId) drop(dragId, f.id); setDragId(null); }}
                  onDragEnd={() => setDragId(null)}
                >
                  <span className="pfp-row__grip" title={t("profileFields.dragHint")} aria-hidden="true"><FontAwesomeIcon icon={faGripVertical} /></span>
                  <button type="button" className="pfp-row__hit" aria-pressed={on} onClick={() => pick(f.id)}>
                    <span className="pfp-type" aria-hidden="true">{TYPE_SHORT[x.type]}</span>
                    <span className="pfp-row__text">
                      <span className="pfp-row__name">
                        {fieldLabel({ key: f.key, label: x.label }) || t("profileFields.untitled")}
                        {f.isSystem && <span className="pfp-badge"><FontAwesomeIcon icon={faLock} /> {t("profileFields.builtIn")}</span>}
                      </span>
                      <span className="pfp-row__meta">
                        <code>{f.key}</code>
                        <span aria-hidden="true">·</span>
                        <span className={x.signup === "off" ? "" : "is-accent"}>{t(`profileFields.signupShort.${x.signup}`)}</span>
                        <span aria-hidden="true">·</span>
                        <span className={x.showOnProfile ? "" : "is-warn"}>{x.showOnProfile ? t("profileFields.onProfile") : t("profileFields.hiddenOnProfile")}</span>
                      </span>
                    </span>
                    <span className="pfp-fill" title={t("profileFields.fillTitle", { count: answered(f.id) })}>
                      <b>{percent(f.id)}%</b>
                      <span className="pfp-fill__bar" aria-hidden="true"><span style={{ width: `${percent(f.id)}%` }} /></span>
                    </span>
                  </button>
                </div>
              );
            })}
            {!isLoading && fields.length === 0 && <p className="pfp-muted pfp-empty">{t("profileFields.empty")}</p>}
          </div>
          <p className="pfp-muted pfp-list__foot">{t("profileFields.fillHint")}</p>
        </section>

        <section className="pfp-editor" aria-label={current ? fieldLabel(current) : t("profileFields.title")}>
          {!current || !d ? (
            <div className="pfp-editor__none">{t("profileFields.pick")}</div>
          ) : (
            <>
              <header className="pfp-editor__head">
                <span className="pfp-type pfp-type--lg" aria-hidden="true">{TYPE_SHORT[d.type]}</span>
                <div className="pfp-editor__titles">
                  <h2>{fieldLabel({ key: current.key, label: d.label }) || t("profileFields.untitled")}</h2>
                  <p>{t("profileFields.filledLine", { percent: percent(current.id), count: answered(current.id) })}</p>
                </div>
                {current.isSystem && <p className="pfp-editor__note">{t("profileFields.builtInNote")}</p>}
              </header>

              <div className="pfp-block pfp-grid">
                <label className="pfp-field">
                  <span>{t("profileFields.label")}</span>
                  <input className="inp" value={d.label} maxLength={80} onChange={(e) => setDraft({ label: e.target.value })} />
                </label>
                <label className="pfp-field">
                  <span>{t("profileFields.key")} <em>{t("profileFields.keyHint")}</em></span>
                  <input className="inp pfp-mono" value={current.key} disabled />
                </label>
                <div className="pfp-field pfp-grid__wide">
                  <span id="pfp-type">{t("profileFields.type")}</span>
                  <div className="acp-seg acp-seg--auto pfp-types" role="radiogroup" aria-labelledby="pfp-type">
                    {TYPES.map((ty) => (
                      <button key={ty} type="button" role="radio" aria-checked={d.type === ty}
                        className={d.type === ty ? "is-on" : ""}
                        disabled={typeLocked && d.type !== ty}
                        onClick={() => setDraft({ type: ty, ...(ty === "choice" && d.options.length === 0 ? { options: [t("profileFields.optionN", { n: 1 })] } : {}) })}>
                        {t(`profileFields.types.${ty}`)}
                      </button>
                    ))}
                  </div>
                  {typeLocked && !current.isSystem && <em className="pfp-hint">{t("profileFields.typeLocked")}</em>}
                </div>
              </div>

              <div className="pfp-block pfp-grid">
                {/* A date picker and a dropdown never show a placeholder. */}
                {d.type !== "date" && d.type !== "choice" && (
                  <label className="pfp-field">
                    <span>{t("profileFields.placeholder")}</span>
                    <input className="inp" value={d.placeholder} maxLength={120} onChange={(e) => setDraft({ placeholder: e.target.value })} />
                  </label>
                )}
                <label className="pfp-field">
                  <span>{t("profileFields.helpText")}</span>
                  <input className="inp" value={d.helpText} maxLength={200} placeholder={t("profileFields.helpTextPh")} onChange={(e) => setDraft({ helpText: e.target.value })} />
                </label>
              </div>

              {d.type === "choice" && (
                <div className="pfp-block">
                  <Row title={t("profileFields.optionsTitle")} desc={t("profileFields.optionsDesc")} />
                  <div className="mnt-list pfp-options">
                    {d.options.map((o, i) => (
                      <div key={i} className="mnt-list__row">
                        <input className="inp inp--sm" value={o} maxLength={80} aria-label={t("profileFields.optionN", { n: i + 1 })}
                          onChange={(e) => setDraft({ options: d.options.map((x, j) => (j === i ? e.target.value : x)) })} />
                        <button type="button" className="pfp-iconbtn" aria-label={t("profileFields.removeOption")}
                          disabled={d.options.length <= 1}
                          onClick={() => setDraft({ options: d.options.filter((_x, j) => j !== i) })}>
                          <FontAwesomeIcon icon={faXmark} />
                        </button>
                      </div>
                    ))}
                    {d.options.length < 50 && (
                      <button type="button" className="mnt-add" onClick={() => setDraft({ options: [...d.options, t("profileFields.optionN", { n: d.options.length + 1 })] })}>
                        <FontAwesomeIcon icon={faPlus} /> {t("profileFields.addOption")}
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="pfp-block pfp-line">
                <Row title={t("profileFields.signupTitle")} desc={t("profileFields.signupDesc")} />
                <Seg label={t("profileFields.signupTitle")} value={d.signup} options={["off", "optional", "required"] as const}
                  text={(v) => t(`profileFields.signupMode.${v}`)} onChange={(v) => setDraft({ signup: v })} />
              </div>

              <div className="pfp-block pfp-line">
                <Row title={t("profileFields.profileTitle")} desc={t("profileFields.profileDesc")} />
                <Toggle on={d.showOnProfile} onToggle={() => setDraft({ showOnProfile: !d.showOnProfile })} label={t("profileFields.profileTitle")} />
              </div>

              <div className="pfp-block pfp-line">
                <Row title={t("profileFields.privacyTitle")} desc={t("profileFields.privacyDesc")} />
                <Seg label={t("profileFields.privacyTitle")} value={d.defaultPrivacy} options={["public", "members", "nobody"] as const}
                  text={(v) => t(`profileFields.privacy.${v}`)} onChange={(v) => setDraft({ defaultPrivacy: v })} />
              </div>

              {d.type === "date" && (
                <div className="pfp-block pfp-line">
                  <Row title={t("profileFields.dobTitle")} desc={t(`profileFields.dobExample.${d.dobDisplayFormat}`)} />
                  <Seg label={t("profileFields.dobTitle")} value={d.dobDisplayFormat} options={["age", "birthday", "full"] as const}
                    text={(v) => t(`profileFields.dob.${v}`)} onChange={(v) => setDraft({ dobDisplayFormat: v })} />
                </div>
              )}

              {current.key === "date_of_birth" && (
                <div className="pfp-block pfp-line">
                  <Row title={t("profileFields.minAgeTitle")} desc={t("profileFields.minAgeDesc")} />
                  <NumberStepper value={d.minAge} min={0} max={120} onChange={(v) => setDraft({ minAge: v })} />
                </div>
              )}

              {(d.type === "text" || d.type === "longtext") && (
                <div className="pfp-block pfp-grid">
                  <label className="pfp-field">
                    <span>{t("profileFields.maxLengthTitle")}</span>
                    <input className="inp" inputMode="numeric" value={d.maxLength} placeholder={String(TYPE_MAX[d.type])}
                      onChange={(e) => setDraft({ maxLength: e.target.value.replace(/\D/g, "").slice(0, 4) })} />
                    <em className="pfp-hint">{t("profileFields.maxLengthDesc", { max: TYPE_MAX[d.type] })}</em>
                  </label>
                  {d.type === "text" && (
                    <label className="pfp-field">
                      <span>{t("profileFields.linkTitle")}</span>
                      <input className="inp pfp-mono" value={d.linkPrefix} maxLength={200} placeholder="https://github.com/"
                        onChange={(e) => setDraft({ linkPrefix: e.target.value })} />
                      <em className="pfp-hint">{t("profileFields.linkDesc")}</em>
                    </label>
                  )}
                </div>
              )}

              {!current.isSystem && (
                <div className="pfp-block pfp-line pfp-danger">
                  <Row title={t("profileFields.deleteTitle")} desc={t("profileFields.deleteDesc", { count: answered(current.id) })} />
                  <Button variant="danger" disabled={remove.isPending} onClick={() => confirmDelete(current)}>
                    <FontAwesomeIcon icon={faTrash} /> {t("profileFields.deleteBtn")}
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ value, label, sub }: { value: number | string; label: string; sub: string }) {
  return (
    <div className="pfp-stat">
      <b>{value}</b>
      <span className="pfp-caps">{label}</span>
      <span className="pfp-muted">{sub}</span>
    </div>
  );
}

function Row({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="pfp-line__text">
      <div className="set-row__label">{title}</div>
      <div className="set-row__desc">{desc}</div>
    </div>
  );
}

function Seg<V extends string>({ label, value, options, text, onChange }: {
  label: string; value: V; options: readonly V[]; text: (v: V) => string; onChange: (v: V) => void;
}) {
  return (
    <div className="acp-seg acp-seg--auto" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={value === o} className={value === o ? "is-on" : ""} onClick={() => onChange(o)}>
          {text(o)}
        </button>
      ))}
    </div>
  );
}

/** The add form: label, a key made from it (editable until created), the type. */
function NewField({ busy, taken, onCancel, onCreate }: {
  busy: boolean; taken: Set<string>; onCancel: () => void;
  onCreate: (body: { key: string; label: string; type: FieldType }) => void;
}) {
  const { t } = useTranslation("acp");
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [keyEdited, setKeyEdited] = useState(false);
  const [type, setType] = useState<FieldType>("text");
  const theKey = keyEdited ? key : slug(label);
  const keyOk = /^[a-z0-9_]{2,40}$/.test(theKey) && !taken.has(theKey);
  const ok = label.trim().length > 0 && keyOk;

  return (
    <form className="pfp-new" onSubmit={(e) => { e.preventDefault(); if (ok) onCreate({ key: theKey, label: label.trim(), type }); }}>
      <div className="pfp-new__head">
        <b>{t("profileFields.newTitle")}</b>
        <button type="button" className="pfp-iconbtn" aria-label={t("common:actions.cancel")} onClick={onCancel}><FontAwesomeIcon icon={faXmark} /></button>
      </div>
      <label className="pfp-field">
        <span>{t("profileFields.label")}</span>
        <input className="inp" autoFocus value={label} maxLength={80} placeholder={t("profileFields.newLabelPh")} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <label className="pfp-field">
        <span>{t("profileFields.key")}</span>
        <input className="inp pfp-mono" value={theKey} maxLength={40}
          onChange={(e) => { setKeyEdited(true); setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "")); }} />
        <em className={`pfp-hint${theKey && !keyOk ? " is-bad" : ""}`}>
          {taken.has(theKey) ? t("profileFields.keyTaken") : t("profileFields.newKeyHint")}
        </em>
      </label>
      <div className="pfp-field">
        <span>{t("profileFields.type")}</span>
        <select className="inp" value={type} onChange={(e) => setType(e.target.value as FieldType)} aria-label={t("profileFields.type")}>
          {TYPES.map((ty) => <option key={ty} value={ty}>{t(`profileFields.types.${ty}`)}</option>)}
        </select>
      </div>
      <div className="pfp-new__actions">
        <Button variant="ghost" onClick={onCancel}>{t("common:actions.cancel")}</Button>
        <Button type="submit" disabled={!ok || busy}>{t("profileFields.create")}</Button>
      </div>
    </form>
  );
}

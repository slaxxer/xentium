import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../../lib/api";
import { sameValue, useAutosave } from "../../../hooks/useAutosave";
import { SaveChip } from "../../../components/SaveChip";
import { Toggle, TextField, NumberStepper } from "../../../components/AcpControls";
import { ColorField } from "../../../components/ColorField";
import { AcpIcon } from "./acpIcons";
import "./acpSystem.scss";
import "./AddonSettingsPage.scss";

/**
 * An add-on's settings page, drawn by core from the schema the add-on declared
 * (`ctx.registerSettings`, ADR-0011). The add-on ships no page: the JSON Schema says
 * what each field is, its `.meta()` how to show it. Saving goes through the ACP save
 * bar like every other settings page; the server validates again and answers with a
 * message per field, shown under that field.
 */

interface FieldSchema {
  type?: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  default?: unknown;
  title?: string;
  description?: string;
  section?: string;
  widget?: "color" | "textarea";
  /** Labels for an enum's values (plain text or translation keys). */
  options?: Record<string, string>;
}
interface Described {
  pluginId: string;
  title: string | null;
  schema: { properties?: Record<string, FieldSchema> };
  values: Record<string, unknown>;
}

const GENERAL = "";

/** A key in the add-on's namespace is translated; anything else is shown as written. */
function useText() {
  const { t, i18n } = useTranslation("acp");
  return (s: string | undefined, fallback = "") =>
    !s ? fallback : s.includes(":") && i18n.exists(s) ? String(t(s)) : s;
}

const humanize = (key: string) => key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function Control({ field, value, onChange, label }: {
  field: FieldSchema; value: unknown; onChange: (v: unknown) => void; label: string;
}) {
  const txt = useText();
  if (field.type === "boolean") return <Toggle on={!!value} onToggle={() => onChange(!value)} label={label} />;
  if (field.type === "integer" || field.type === "number") {
    return <NumberStepper value={Number(value ?? 0)} onChange={onChange}
                          min={field.minimum ?? 0} max={field.maximum ?? 1_000_000} step={1} />;
  }
  if (field.enum) {
    const opts = field.enum.map(String);
    const name = (o: string) => txt(field.options?.[o], humanize(o));
    if (opts.length <= 4) {
      return (
        <div className="acp-seg acp-seg--auto" role="radiogroup" aria-label={label}>
          {opts.map((o) => (
            <button key={o} type="button" role="radio" aria-checked={value === o}
                    className={value === o ? "is-on" : ""} onClick={() => onChange(o)}>{name(o)}</button>
          ))}
        </div>
      );
    }
    return (
      <select className="inp" value={String(value ?? "")} aria-label={label} onChange={(e) => onChange(e.target.value)}>
        {opts.map((o) => <option key={o} value={o}>{name(o)}</option>)}
      </select>
    );
  }
  if (field.widget === "color") {
    return <ColorField value={String(value ?? "")} fallback={String(field.default ?? "#000000")} onChange={onChange} label={label} />;
  }
  if (field.widget === "textarea") {
    return <textarea className="inp addon-set__textarea" rows={4} maxLength={field.maxLength} value={String(value ?? "")}
                     aria-label={label} onChange={(e) => onChange(e.target.value)} />;
  }
  if (field.type === "string") return <TextField value={String(value ?? "")} onChange={onChange} />;
  return <span className="acp-hint">{String(JSON.stringify(value ?? null))}</span>;
}

export function AddonSettingsPage() {
  const { pluginId = "" } = useParams();
  const { t } = useTranslation("acp");
  const txt = useText();
  const qc = useQueryClient();
  const key = ["acp-addon-settings", pluginId];
  const { data, error } = useQuery<Described>({ queryKey: key, queryFn: () => api.get(`/admin/addons/${pluginId}/settings`) });

  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const saved = data?.values;
  const savedRef = useRef(saved);
  savedRef.current = saved;
  // Seeds once per add-on; a refetch must not overwrite what the admin is typing.
  useEffect(() => { setDraft(null); setErrors({}); }, [pluginId]);
  useEffect(() => { if (saved && !draft) setDraft(saved); }, [saved, draft]);

  const fields = useMemo(() => Object.entries(data?.schema.properties ?? {}), [data]);
  const labelOf = (k: string, f: FieldSchema) => txt(f.title, humanize(k));
  const sections = useMemo(() => {
    const order: string[] = [];
    const by = new Map<string, Array<[string, FieldSchema]>>();
    for (const [k, f] of fields) {
      const s = f.section ?? GENERAL;
      if (!by.has(s)) { by.set(s, []); order.push(s); }
      by.get(s)!.push([k, f]);
    }
    return order.map((s) => ({ name: s, fields: by.get(s)! }));
  }, [fields]);

  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.put<{ values: Record<string, unknown> }>(`/admin/addons/${pluginId}/settings`, patch),
    onSuccess: (r) => { setErrors({}); qc.setQueryData<Described>(key, (d) => (d ? { ...d, values: r.values } : d)); },
    onError: (e) => {
      const fieldErrors = (e as { detail?: { error?: { details?: { fields?: Record<string, string> } } } })?.detail?.error?.details?.fields;
      if (fieldErrors) setErrors(fieldErrors);
    },
  });

  useAutosave({
    value: draft ?? undefined,
    savedValue: saved,
    onSave: (d) => {
      if (!d) return undefined;
      const changed = Object.fromEntries(Object.entries(d).filter(([k, v]) => !sameValue(v, savedRef.current?.[k])));
      return Object.keys(changed).length ? save.mutateAsync(changed) : undefined;
    },
    onDiscard: () => { if (savedRef.current) setDraft(savedRef.current); setErrors({}); },
    describe: (value, base) => fields
      .filter(([k]) => value && base && !sameValue(value[k], base[k]))
      .map(([k, f]) => ({
        key: k,
        label: labelOf(k, f),
        section: f.section ? txt(f.section) : (data?.title ?? pluginId),
        from: String(base?.[k] ?? ""),
        to: String(value?.[k] ?? ""),
        revert: () => setDraft((p) => (p ? { ...p, [k]: savedRef.current?.[k] } : p)),
      })),
  });

  if (error) {
    return <div className="acp-card acp-empty">{t("addonSettings.unavailable")}</div>;
  }

  return (
    <div style={{ maxWidth: 1100 }}>
      <div className="pg-head">
        <div>
          <p className="pg-eyebrow">{t("addonSettings.eyebrow")}</p>
          <h1 className="pg-title">{data?.title ? txt(data.title) : pluginId}</h1>
          <p className="pg-sub">{t("addonSettings.subtitle")}</p>
        </div>
        <SaveChip saving={save.isPending} />
      </div>

      {draft && sections.map((sec) => (
        <section key={sec.name || "general"} className="set-card addon-set">
          <div className="set-card__head">
            <div className="set-card__icon"><AcpIcon name="cog" size={19} /></div>
            <div className="set-card__titles">
              <h3>{sec.name ? txt(sec.name) : t("addonSettings.general")}</h3>
            </div>
          </div>
          <div className="set-rows">
            {sec.fields.map(([k, f]) => {
              const label = labelOf(k, f);
              const wide = f.widget === "textarea";
              return (
                <div key={k} className={`set-row${wide ? " addon-set__stack" : ""}`}>
                  <div>
                    <div className="set-row__label">{label}</div>
                    {f.description && <div className="set-row__desc">{txt(f.description)}</div>}
                    {errors[k] && <div className="addon-set__error" role="alert">{errors[k]}</div>}
                  </div>
                  <div className={`set-row__control${wide ? " addon-set__full" : ""}`}>
                    <Control field={f} value={draft[k]} label={label}
                             onChange={(v) => setDraft((p) => ({ ...(p ?? {}), [k]: v }))} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

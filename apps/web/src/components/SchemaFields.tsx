/**
 * A form rendered from JSON Schema.
 *
 * One renderer for every ACP surface whose fields are derived from a Zod schema
 * rather than hand-written: scheduled-task action params, and block props in the
 * layout editor. Adding a field to either contract needs no frontend change,
 * and — more importantly — the form can never post a shape the server rejects,
 * because both read the same schema.
 *
 * The server always re-validates. This form is a convenience, never the guarantee.
 */
import { useTranslation } from "react-i18next";
import { hostText } from "../lib/coreText";
import "./SchemaFields.scss";
import { IconPicker } from "./IconPicker";
import { ToggleGlyph } from "./Toggle";
import { ImageField, RichTextField } from "./SchemaFieldControls";

/** The JSON Schema subset our Zod contracts actually produce. */
export interface SchemaProp {
  /** A hint the editor may honour: "icon", "image", "richtext", "datetime". */
  format?: string;
  type?:        string;
  title?:       string;
  description?: string;
  default?:     unknown;
  enum?:        unknown[];
  /** A single-value branch — Zod literals become these inside `anyOf`. */
  const?:       unknown;
  /** Unions: `z.union([...])`, `z.literal(1) | z.literal(2)`, etc. */
  anyOf?:       SchemaProp[];
  minimum?:     number;
  maximum?:     number;
}

export interface FieldSchema {
  properties?: Record<string, SchemaProp>;
  required?:   string[];
}

export type FieldValues = Record<string, unknown>;

const SUPPORTED = new Set(["string", "number", "integer", "boolean"]);

/**
 * Flatten the union shapes Zod emits into something renderable.
 *
 *  - A union of literals (`z.union([z.literal(1), …])`) becomes an enum.
 *  - A union of a primitive and a richer shape — e.g. `LocalizedText`, which is
 *    "a literal string OR an i18n reference" — renders as the primitive. The
 *    other branch is a form only code produces: an admin typing into the field
 *    is authoring a literal, never a translation key.
 *
 * Anything still unrenderable falls through and gets skipped, which is the
 * honest outcome: better no control than one that posts the wrong shape.
 */
function normalize(prop: SchemaProp): SchemaProp {
  const branches = prop.anyOf;
  if (!branches?.length) return prop;

  if (branches.every((b) => b.const !== undefined)) {
    return {
      ...prop,
      type: branches[0]!.type ?? "string",
      enum: branches.map((b) => b.const),
    };
  }

  const primitive = branches.find((b) => SUPPORTED.has(b.type ?? ""));
  if (!primitive) return prop;
  // Keep the parent's label/description/default — the branch carries neither.
  return { ...primitive, title: prop.title, description: prop.description, default: prop.default };
}

/** "graceHours" → "Grace hours". Only used when the schema sets no title. */
export function prettify(key: string): string {
  const s = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** Seed values from the schema's defaults — the shape the server would apply
 *  anyway, made visible so the admin can see what they are agreeing to. */
export function defaultsFor(schema: FieldSchema | null | undefined): FieldValues {
  const out: FieldValues = {};
  for (const [key, prop] of Object.entries(schema?.properties ?? {})) {
    if (prop.default !== undefined) out[key] = prop.default;
  }
  return out;
}

export function SchemaFields({ schema, values, onChange, omit, compact, textKey }: {
  schema: FieldSchema | null | undefined;
  values: FieldValues;
  onChange: (next: FieldValues) => void;
  /**
   * Fields a caller renders ITSELF with a purpose-built control.
   *
   * The generic form is deliberately plain — it can only produce inputs, selects and
   * checkboxes — so a prop that deserves a colour picker or a file upload is handed
   * back to the caller rather than shown twice or shown badly. Omitting is a display
   * choice only: the value still lives in the same props object and the server still
   * validates it against the same schema.
   */
  omit?: readonly string[];
  /**
   * Richer controls for a panel that is READ AT A GLANCE.
   *
   * ⚠ Opt-in, not the default. This component also draws plugin config pages and task
   * parameter forms, where the plain input/select/checkbox set is the established look
   * and a silent restyle would change screens nobody asked about. The Layout Editor's
   * inspector is a narrow floating panel scanned between edits, where a switch reads
   * as on/off without being read and a short enum is quicker to hit than to open.
   *
   * It changes only how a value is PICKED. Same keys, same values, same schema, same
   * server validation.
   */
  compact?: boolean;
  /**
   * Where this schema's titles, descriptions and option names are translated, under
   * `acp:core` — e.g. `blocks.section.props`. Each falls back to what the schema
   * itself says, so a plugin's form (no such entries) reads exactly as it did.
   */
  textKey?: string;
}) {
  const { t } = useTranslation("acp");
  const hidden = new Set(omit ?? []);
  const props = Object.entries(schema?.properties ?? {}).filter(([key]) => !hidden.has(key));

  if (schema === null) return <div className="acp-hint">{t("tasks.paramsUnsupported")}</div>;
  if (props.length === 0) return null;


  const set = (key: string, value: unknown) => onChange({ ...values, [key]: value });
  const required = new Set(schema?.required ?? []);

  return (
    <>
      {props.map(([key, rawProp]) => {
        const prop = normalize(rawProp);
        // Unsupported types are skipped rather than guessed at — a half-rendered
        // control that posts the wrong shape is worse than no control.
        const tx = (field: string, fallback: string) => textKey ? hostText(`${textKey}.${key}.${field}`, fallback) : fallback;
        // Rich text has no JSON-schema type (it is a document), so it is matched by
        // its format before the primitive check would skip it.
        if (prop.format === "richtext") {
          return (
            <div className="acp-form-field" key={key}>
              <label className="acp-label">{tx("title", prop.title ?? prettify(key))}</label>
              <RichTextField value={values[key]} onChange={(json) => set(key, json)} />
              {prop.description && <div className="acp-hint">{tx("description", prop.description)}</div>}
            </div>
          );
        }
        if (!SUPPORTED.has(prop.type ?? "")) return null;
        const label = tx("title", prop.title ?? prettify(key));
        const description = prop.description ? tx("description", prop.description) : undefined;
        const optLabel = (opt: unknown) => tx(`enum.${String(opt)}`, String(opt));
        const value = values[key] ?? prop.default;
        const numeric = prop.type === "number" || prop.type === "integer";
        // A value the primitive control cannot represent — e.g. a LocalizedText
        // i18n reference from a code default. Show the key as a placeholder so
        // the admin can see what is there; typing replaces it with a literal.
        const nonPrimitive = value !== null && typeof value === "object";
        const refHint = nonPrimitive ? String((value as { key?: string }).key ?? "") : undefined;

        if (prop.type === "boolean") {
          // A SWITCH, when the caller asked for one: still a real checkbox, so it
          // keeps the label association, the focus ring and the keyboard behaviour —
          // only its appearance changes, to the one toggle glyph (components/Toggle).
          if (compact) {
            return (
              <label className="sf-switch" key={key}>
                <span className="sf-switch__text">
                  <b>{label}</b>
                  {description && <span className="acp-hint">{description}</span>}
                </span>
                <input type="checkbox" checked={Boolean(value)}
                  onChange={(e) => set(key, e.target.checked)} />
                <span className="sf-switch__track" aria-hidden="true"><ToggleGlyph on={Boolean(value)} /></span>
              </label>
            );
          }
          return (
            <label key={key} style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer", marginBottom: 14 }}>
              <input type="checkbox" checked={Boolean(value)}
                onChange={(e) => set(key, e.target.checked)} style={{ marginTop: 3 }} />
              <span>
                <b style={{ fontSize: "var(--fs-sm)" }}>{label}</b>
                {description && <div className="acp-hint" style={{ marginTop: 2 }}>{description}</div>}
              </span>
            </label>
          );
        }

        return (
          <div className="acp-form-field" key={key}>
            <label className="acp-label">
              {label}
              {!required.has(key) && <span style={{ color: "var(--c-fg-subtle)" }}> · {t("tasks.optional")}</span>}
            </label>
            {/* A SHORT enum becomes a segmented control: every option visible, one
                click to change, no menu to open. Past four it goes back to a select —
                a row of eight buttons in a 320px panel wraps into a wall. */}
            {prop.enum && compact && prop.enum.length <= 4 ? (
              <div className="sf-seg" role="group" aria-label={label}>
                {prop.enum.map((opt) => {
                  const on = String(value ?? "") === String(opt);
                  return (
                    <button key={String(opt)} type="button"
                      className={on ? "is-on" : ""}
                      aria-pressed={on}
                      onClick={() => set(key, numeric ? Number(opt) : opt)}>
                      {optLabel(opt)}
                    </button>
                  );
                })}
              </div>
            ) : prop.enum ? (
              <select className="acp-input" value={String(value ?? "")}
                onChange={(e) => set(key, numeric ? Number(e.target.value) : e.target.value)}>
                {prop.enum.map((opt) => (
                  <option key={String(opt)} value={String(opt)}>{optLabel(opt)}</option>
                ))}
              </select>
            ) : prop.type === "string" && prop.format === "icon" ? (
              /* ⚠ A FORMAT hint, not a new prop type. Any block — core or plugin —
                 that declares `.meta({ format: "icon" })` gets the picker with no
                 change here and no registration of its own, which is the same
                 "blocks declare, the editor renders" split ADR-0005 already uses. */
              <IconPicker
                value={nonPrimitive ? "" : String(value ?? "")}
                onChange={(tok) => set(key, tok)}
              />
            ) : prop.type === "string" && prop.format === "datetime" ? (
              /* Stored as the picker gives it ("2026-12-24T18:00"), read in the viewer's zone. */
              <input className="acp-input" type="datetime-local"
                value={nonPrimitive ? "" : String(value ?? "")}
                onChange={(e) => set(key, e.target.value || undefined)} />
            ) : prop.type === "string" && prop.format === "image" ? (
              <ImageField value={nonPrimitive ? "" : String(value ?? "")} onChange={(v) => set(key, v || undefined)} />
            ) : prop.type === "string" ? (
              <input className="acp-input"
                value={nonPrimitive ? "" : String(value ?? "")}
                placeholder={refHint}
                onChange={(e) => set(key, e.target.value)} />
            ) : (
              <input className="acp-input" type="number" style={{ width: 180 }}
                min={prop.minimum} max={prop.maximum}
                value={value === undefined || value === null ? "" : String(value)}
                // Empty means "unset" — sending NaN would fail validation with a
                // message about types rather than about the missing value.
                onChange={(e) => set(key, e.target.value === "" ? undefined : Number(e.target.value))} />
            )}
            {description && <div className="acp-hint">{description}</div>}
          </div>
        );
      })}
    </>
  );
}

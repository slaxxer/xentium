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

/** The JSON Schema subset our Zod contracts actually produce. */
export interface SchemaProp {
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

export function SchemaFields({ schema, values, onChange }: {
  schema: FieldSchema | null | undefined;
  values: FieldValues;
  onChange: (next: FieldValues) => void;
}) {
  const { t } = useTranslation("acp");
  const props = Object.entries(schema?.properties ?? {});

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
        if (!SUPPORTED.has(prop.type ?? "")) return null;
        const label = prop.title ?? prettify(key);
        const value = values[key] ?? prop.default;
        const numeric = prop.type === "number" || prop.type === "integer";
        // A value the primitive control cannot represent — e.g. a LocalizedText
        // i18n reference from a code default. Show the key as a placeholder so
        // the admin can see what is there; typing replaces it with a literal.
        const nonPrimitive = value !== null && typeof value === "object";
        const refHint = nonPrimitive ? String((value as { key?: string }).key ?? "") : undefined;

        if (prop.type === "boolean") {
          return (
            <label key={key} style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer", marginBottom: 14 }}>
              <input type="checkbox" checked={Boolean(value)}
                onChange={(e) => set(key, e.target.checked)} style={{ marginTop: 3 }} />
              <span>
                <b style={{ fontSize: 13 }}>{label}</b>
                {prop.description && <div className="acp-hint" style={{ marginTop: 2 }}>{prop.description}</div>}
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
            {prop.enum ? (
              <select className="acp-input" value={String(value ?? "")}
                onChange={(e) => set(key, numeric ? Number(e.target.value) : e.target.value)}>
                {prop.enum.map((opt) => (
                  <option key={String(opt)} value={String(opt)}>{String(opt)}</option>
                ))}
              </select>
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
            {prop.description && <div className="acp-hint">{prop.description}</div>}
          </div>
        );
      })}
    </>
  );
}

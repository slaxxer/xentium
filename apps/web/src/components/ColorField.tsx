import "./ColorField.scss";
import { ColorInput } from "./ColorInput";

export const isHex = (v: string) => /^#[0-9a-f]{6}$/i.test(v);

/** The browser's picker and a hex field: one colour, two ways in. */
export function ColorField({ value, fallback, onChange, label }: {
  value: string; fallback: string; onChange: (v: string) => void; label: string;
}) {
  const shown = isHex(value) ? value : fallback;
  return (
    <div className="color-field">
      <label className="color-field__swatch" style={{ background: shown }}>
        <ColorInput value={shown} aria-label={label} onChange={(v) => onChange(v)} />
      </label>
      <input className={`inp is-mono color-field__hex${isHex(value) ? "" : " is-invalid"}`} value={value} maxLength={7}
             placeholder={fallback} aria-label={label} onChange={(e) => onChange(e.target.value.trim())} />
    </div>
  );
}

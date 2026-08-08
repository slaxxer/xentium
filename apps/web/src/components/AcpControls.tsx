import { useTranslation } from "react-i18next";

/**
 * The ACP's settings-row form controls. Shared rather than duplicated so every
 * `set-row__control` across the admin renders the same element — a page that
 * hand-rolls a look-alike input is how ACP screens drift apart.
 * Styling lives in acpSystem.scss (`.sw`, `.inp`, `.stepper`).
 */

export function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`sw${on ? " is-on" : ""}`}
      onClick={onToggle}
    />
  );
}

export function TextField({
  value, onChange, placeholder, type = "text",
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <input
      className="inp"
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function NumberStepper({
  value, onChange, min = 0, max = 999, step = 1,
}: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number;
}) {
  const { t } = useTranslation("common");
  const set = (v: number) => onChange(Math.max(min, Math.min(max, v)));
  return (
    <div className="stepper">
      <button type="button" aria-label={t("actions.decrease")} onClick={() => set(value - step)}>−</button>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value === "" ? min : Number(e.target.value))}
        onBlur={(e) => set(Number(e.target.value) || min)}
      />
      <button type="button" aria-label={t("actions.increase")} onClick={() => set(value + step)}>+</button>
    </div>
  );
}

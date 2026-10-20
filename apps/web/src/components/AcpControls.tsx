import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "./Icon";

/**
 * The ACP's settings-row form controls. Shared rather than duplicated so every
 * `set-row__control` across the admin renders the same element — a page that
 * hand-rolls a look-alike input is how ACP screens drift apart.
 * Styling lives in acpSystem.scss (`.inp`, `.stepper`); the switch in components/Toggle.scss.
 */

/** The switch now lives in Toggle.tsx; re-exported here because pages and plugins
 *  (through the `webAcpControls` host global) import it from AcpControls. */
export { Toggle, ToggleGlyph } from "./Toggle";

/**
 * THE ACP button. One size everywhere in the admin (buttons.scss: there is no small
 * or large in the ACP), four looks. Use it instead of a hand-styled <button> for
 * any action with a label; plugins get it through the `webAcpControls` host global.
 */
export function Button({
  variant = "primary", icon, children, className, type = "button", ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  variant?: "primary" | "ghost" | "danger" | "ghost-danger";
  icon?: IconDefinition;
  children?: ReactNode;
}) {
  return (
    <button type={type} className={`btn-${variant}${className ? ` ${className}` : ""}`} {...rest}>
      {icon && <FontAwesomeIcon icon={icon} />}
      {children}
    </button>
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

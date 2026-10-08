import { faToggleOff, faToggleOn } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "./Icon";
import "./Toggle.scss";

/**
 * THE on/off switch, everywhere — ACP and site alike: FontAwesome's toggle glyph,
 * accent when on, muted when off (the look ACP → Progression always had). Being an
 * icon, it follows the site's icon kit and style like every other icon.
 *
 * A `<button role="switch">`, not a checkbox: most switches save on click, and a
 * checkbox inside a label gives two click targets that can double-fire the save.
 */
export function Toggle({ on, onToggle, disabled, label, className = "" }: {
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
  /** For a switch with no visible label next to it. */
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`xt-toggle${on ? " is-on" : ""}${className ? ` ${className}` : ""}`}
      onClick={onToggle}
    >
      <ToggleGlyph on={on} />
    </button>
  );
}

/**
 * The glyph alone, for a control that is ALREADY the button or the input — a
 * permission tile, a label around a real checkbox. `implied` = on because of
 * something else (a permission another one grants), drawn half-strength.
 */
export function ToggleGlyph({ on, implied = false }: { on: boolean; implied?: boolean }) {
  return (
    <FontAwesomeIcon
      icon={on || implied ? faToggleOn : faToggleOff}
      className={`xt-toggle__icon${on ? " is-on" : implied ? " is-implied" : ""}`}
      aria-hidden
    />
  );
}

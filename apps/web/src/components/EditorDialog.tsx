import type { ReactNode } from "react";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "./Icon";
import "./EditorDialog.scss";

/**
 * The ACP's editor dialog: for making or editing ONE thing that has a look.
 *
 * A rail on the left says what is being made (a live preview of its mark, its name
 * and key) and which part of it the pane shows (tabs); the pane edits that part with
 * core's setting rows, and its footer holds the explicit Cancel / Create buttons
 * (create and edit dialogs are not drafts, see docs/plugin-acp-pages.md).
 *
 * First drawn for badges; plugins get it through the `webEditorDialog` host global,
 * so a plugin's dialog is the same dialog, not a look-alike.
 */
export interface EditorDialogTab {
  id: string;
  label: string;
  /** Drawn before the label; any icon element. */
  icon?: ReactNode;
  /** A short marker after the label ("On"). */
  mark?: string;
}

export function EditorDialog({
  mark, name, nameEmpty, sub, tabs, tab, onTab, railNote,
  title, description, onClose, closeLabel, footNote, actions, children, className,
}: {
  /** The live preview's mark (a badge, an icon tile…). */
  mark: ReactNode;
  /** The preview's name; `nameEmpty` while it has none yet. */
  name: string;
  nameEmpty?: boolean;
  /** A line under the name, shown as code (a key, an address). */
  sub?: ReactNode;
  tabs: EditorDialogTab[];
  tab: string;
  onTab: (id: string) => void;
  /** A note at the foot of the rail. */
  railNote?: ReactNode;
  title: string;
  description?: ReactNode;
  onClose: () => void;
  closeLabel: string;
  /** The footer's note, beside the buttons. */
  footNote?: ReactNode;
  /** The footer's buttons, usually Cancel and Create/Save. */
  actions: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="acp-modal-overlay" onClick={onClose}>
      <div className={`acp-modal xed${className ? ` ${className}` : ""}`} role="dialog" aria-modal="true" aria-label={title}
        onClick={(e) => e.stopPropagation()}>
        <aside className="xed__rail">
          <div className="xed-preview">
            <div className="xed-preview__mark">{mark}</div>
            <div className="xed-preview__id">
              <div className={`xed-preview__name${nameEmpty ? " is-empty" : ""}`}>{name}</div>
              {sub != null && <code>{sub}</code>}
            </div>
          </div>

          <nav className="xed-tabs">
            {tabs.map((x) => (
              <button key={x.id} type="button" className={`xed-tab${tab === x.id ? " is-on" : ""}`}
                aria-current={tab === x.id ? "page" : undefined} onClick={() => onTab(x.id)}>
                {x.icon}
                <span>{x.label}</span>
                {x.mark && <em className="xed-tab__mark">{x.mark}</em>}
              </button>
            ))}
          </nav>

          {railNote && <p className="xed__note">{railNote}</p>}
        </aside>

        <div className="xed__pane">
          <div className="xed__head">
            <div>
              <h2>{title}</h2>
              {description && <p>{description}</p>}
            </div>
            <button type="button" className="xed-close" onClick={onClose} title={closeLabel} aria-label={closeLabel}>
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>

          <div className="xed__body">{children}</div>

          <div className="xed__foot">
            <span>{footNote}</span>
            {actions}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A colour choice: preset swatches, then the system colour picker for any other.
 * Values are #rrggbb.
 */
export function ColorSwatches({ value, onChange, swatches }: {
  value: string;
  onChange: (hex: string) => void;
  swatches: readonly string[];
}) {
  const v = value.toLowerCase();
  return (
    <div className="xed-swatches">
      {swatches.map((c) => (
        <button key={c} type="button" title={c} className={`xed-swatch${v === c.toLowerCase() ? " is-on" : ""}`}
          style={{ background: c }} aria-label={c} aria-pressed={v === c.toLowerCase()} onClick={() => onChange(c)} />
      ))}
      <span className="xed-swatches__sep" />
      {/* The swatches are a starting point, not the whole range. */}
      <label className="xed-custom">
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"} onChange={(e) => onChange(e.target.value)} />
        <span>{value}</span>
      </label>
    </div>
  );
}

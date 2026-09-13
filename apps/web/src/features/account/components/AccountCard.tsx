/**
 * A settings card: a title, a line saying what it is for, and a body.
 *
 * ⚠ It replaced the ACCORDION every section used to sit in. An accordion hides the
 * one thing a settings page is for — an account page is read by someone looking for
 * a setting they cannot name, and a column of closed titles makes them click five
 * times to find it. Everything is open; the side nav and its search are what narrow
 * the page now.
 *
 * `aside` is the header's right-hand slot: a chip, a link, a one-off action that
 * belongs to the card rather than to a row inside it.
 */
import type { ReactNode } from "react";

export function AccountCard({
  title, desc, aside, danger, children,
}: {
  title:    string;
  desc?:    string;
  aside?:   ReactNode;
  /** A card whose action cannot be undone. Draws the border in the danger colour. */
  danger?:  boolean;
  children: ReactNode;
}) {
  return (
    <section className={`acct-card${danger ? " acct-card--danger" : ""}`}>
      <header className="acct-card__head">
        <div className="acct-card__titles">
          <h2>{title}</h2>
          {desc && <p>{desc}</p>}
        </div>
        {aside && <div className="acct-card__aside">{aside}</div>}
      </header>
      <div className="acct-card__body">{children}</div>
    </section>
  );
}

/**
 * One setting inside a card: what it is on the left, the control on the right.
 *
 * ⚠ `label` is a plain node, not a `<label>` element, and the row does NOT wrap its
 * control in one. Several controls here are `<button role="switch">` rather than an
 * input, and a `<label>` around a button swallows the click on Safari.
 */
export function AccountRow({
  label, desc, control, wide, variant, htmlFor,
}: {
  label:   string;
  desc?:   string;
  control: ReactNode;
  /** Give the control the wider column — for a select with sentence-long options. */
  wide?:   boolean;
  /** `link` puts the label in a fixed 150px column and lets the field take the rest. */
  variant?: "link";
  htmlFor?: string;
}) {
  return (
    <div className={`acct-row${wide ? " acct-row--wide" : ""}${variant ? ` acct-row--${variant}` : ""}`}>
      <div className="acct-row__text">
        {htmlFor
          ? <label className="acct-row__label" htmlFor={htmlFor}>{label}</label>
          : <span className="acct-row__label">{label}</span>}
        {desc && <span className="acct-row__desc">{desc}</span>}
      </div>
      <div className="acct-row__control">{control}</div>
    </div>
  );
}

/**
 * The switch, as the account page draws it.
 *
 * ⚠ `role="switch"` on a BUTTON, not a checkbox: every toggle on this page saves on
 * click, and a checkbox inside a label gives you two click targets that can
 * double-fire the save.
 */
export function AccountSwitch({
  on, onToggle, disabled, label,
}: {
  on: boolean; onToggle: () => void; disabled?: boolean; label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`account-toggle__btn${on ? " account-toggle__btn--on" : ""}`}
      onClick={onToggle}
    >
      <span className="account-toggle__knob" />
    </button>
  );
}

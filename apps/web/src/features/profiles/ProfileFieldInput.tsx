import { DOB_MIN, dobMax } from "../../lib/dob";

/** What a form needs to know about a profile field to draw its input. */
export interface ProfileFieldShape {
  key: string;
  type: string;
  placeholder?: string | null;
  maxLength?: number | null;
  options?: string[] | null;
}

/** The type's own limit when the field sets none (the server's TYPE_MAX_LENGTH). */
const TYPE_MAX: Record<string, number> = { text: 255, longtext: 2000, email: 254, url: 500 };

/**
 * One profile field's input, the same on the sign-up form and in Account → Profile:
 * a textarea for long text, a select for a choice, a bounded date picker for the
 * date of birth, else an input of the matching type. Each form passes its own
 * classes. The server checks everything again.
 */
export function ProfileFieldInput({
  field, value, onChange, id, className, textareaClassName, required, chooseLabel, ariaLabel,
}: {
  field: ProfileFieldShape;
  value: string;
  onChange: (value: string) => void;
  id?: string;
  className: string;
  textareaClassName?: string;
  required?: boolean;
  /** The empty first option of a choice. */
  chooseLabel: string;
  ariaLabel?: string;
}) {
  const max = field.maxLength ?? TYPE_MAX[field.type];
  const common = { id, required, "aria-label": ariaLabel };

  if (field.type === "longtext") {
    return (
      <textarea {...common} className={textareaClassName ?? className} rows={4} value={value} maxLength={max}
        placeholder={field.placeholder ?? ""} onChange={(e) => onChange(e.target.value)} />
    );
  }
  if (field.type === "choice") {
    const options = field.options ?? [];
    return (
      <select {...common} className={className} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{chooseLabel}</option>
        {/* An answer whose option was since removed still shows, so saving doesn't silently clear it. */}
        {value && !options.includes(value) && <option value={value}>{value}</option>}
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  const isDob = field.key === "date_of_birth";
  const type = field.type === "date" ? "date" : field.type === "email" ? "email" : field.type === "url" ? "url" : "text";
  return (
    <input {...common} className={className} type={type} value={value} placeholder={field.placeholder ?? ""}
      {...(isDob ? { min: DOB_MIN, max: dobMax() } : {})}
      {...(type !== "date" && max ? { maxLength: max } : {})}
      onChange={(e) => onChange(e.target.value)} />
  );
}

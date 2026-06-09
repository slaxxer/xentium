import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown } from "@fortawesome/free-solid-svg-icons";

interface AccordionSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function AccordionSection({ title, defaultOpen = false, children }: AccordionSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`security-accordion${open ? " security-accordion--open" : ""}`}>
      <button
        type="button"
        className="security-accordion__header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="security-accordion__title">{title}</span>
        <FontAwesomeIcon icon={faChevronDown} className="security-accordion__chevron" />
      </button>
      {open && <div className="security-accordion__body">{children}</div>}
    </div>
  );
}

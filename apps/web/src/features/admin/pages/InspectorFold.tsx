/**
 * One collapsible row of the block inspector ("Who sees it", "Edge art").
 *
 * Closed by default so the block's own settings stay on screen; open by default when
 * the block already USES it, because a restriction or a shape nobody can see at a
 * glance is how a block ends up hidden from people for reasons nobody remembers.
 */
import { useState, type ReactNode } from "react";
import { FontAwesomeIcon } from "../../../components/Icon";
import { faChevronRight } from "@fortawesome/free-solid-svg-icons";

export function InspectorFold({ title, active, defaultOpen, children }: {
  title: string;
  /** The block uses this — draws the dot and opens the fold to begin with. */
  active?: boolean;
  /** Open to begin with, without the dot. */
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(!!active || !!defaultOpen);
  return (
    <div className={`lay-fold${open ? " is-open" : ""}`}>
      <button type="button" className="lay-fold__head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>{title}</span>
        {active && <span className="lay-fold__dot" aria-hidden="true" />}
        <FontAwesomeIcon icon={faChevronRight} className="lay-fold__chev" />
      </button>
      {open && <div className="lay-fold__body">{children}</div>}
    </div>
  );
}

/**
 * Stored rich text (sanitized HTML), drawn as-is, with every plugin embed
 * placeholder in it replaced by the plugin's renderer.
 *
 * ⚠ Only for HTML that went through the server's `sanitizeRichText` on write.
 * The embeds are portals into the placeholder divs, so the HTML around them is
 * never re-parsed or re-rendered by React.
 *
 * A host global (`webRichHtml`): plugins that show posts (the forum) use it so a
 * poll in a post is drawn the same way an article draws one.
 */
import { useLayoutEffect, useRef, useState, type HTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { EMBED_ID_RE, EMBED_TYPE_RE } from "@xentium/contracts";
import { EmbedView } from "./EmbedView";

interface Slot { el: HTMLElement; type: string; id: string }

type Props = Omit<HTMLAttributes<HTMLDivElement>, "dangerouslySetInnerHTML" | "children"> & { html: string };

export function RichHtml({ html, ...rest }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [slots, setSlots] = useState<Slot[]>([]);

  useLayoutEffect(() => {
    const found: Slot[] = [];
    ref.current?.querySelectorAll<HTMLElement>("div[data-xt-embed]").forEach((el) => {
      const type = el.getAttribute("data-xt-embed") ?? "";
      const id = el.getAttribute("data-id") ?? "";
      if (EMBED_TYPE_RE.test(type) && EMBED_ID_RE.test(id)) found.push({ el, type, id });
    });
    setSlots(found);
  }, [html]);

  return (
    <>
      <div ref={ref} {...rest} dangerouslySetInnerHTML={{ __html: html }} />
      {slots.map((s) => createPortal(<EmbedView type={s.type} id={s.id} />, s.el, `${s.type}:${s.id}`))}
    </>
  );
}

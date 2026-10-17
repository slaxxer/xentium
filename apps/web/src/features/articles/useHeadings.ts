/**
 * "On this page" for the article reader: the article's own h2/h3 headings, with ids so
 * the side column can jump to them, and the one being read.
 *
 * The body is drawn by TipTap after mount, so the headings are read with a
 * MutationObserver rather than once. Ids are made from the heading text (unique per
 * article), which also makes `#section` links shareable.
 */
import { useEffect, useState, type RefObject } from "react";

export interface Heading { id: string; text: string; level: 2 | 3 }

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "section";

export function useHeadings(ref: RefObject<HTMLElement | null>, key: string | undefined) {
  const [toc, setToc] = useState<Heading[]>([]);
  const [activeHeading, setActive] = useState<string | null>(null);
  // Bumped whenever the heading ELEMENTS change: TipTap re-renders nodes, and an
  // observer still watching the old ones would never mark anything as read.
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const read = () => {
      const seen = new Map<string, number>();
      const found: Heading[] = [];
      root.querySelectorAll<HTMLHeadingElement>("h2, h3").forEach((h) => {
        const text = h.textContent?.trim() ?? "";
        if (!text) return;
        const base = `s-${slug(text)}`;
        const n = (seen.get(base) ?? 0) + 1; seen.set(base, n);
        const id = n > 1 ? `${base}-${n}` : base;
        if (h.id !== id) h.id = id;
        found.push({ id, text, level: h.tagName === "H3" ? 3 : 2 });
      });
      setToc((prev) => (prev.length === found.length && prev.every((p, i) => p.id === found[i]!.id) ? prev : found));
    };
    let last: Element[] = [];
    const readAll = () => {
      read();
      const now = [...root.querySelectorAll("h2, h3")];
      if (now.length !== last.length || now.some((el, i) => el !== last[i])) { last = now; setGeneration((g) => g + 1); }
    };
    readAll();
    const mo = new MutationObserver(readAll);
    mo.observe(root, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, [ref, key]);

  // The heading nearest the top of the screen is the one being read.
  useEffect(() => {
    if (toc.length === 0) return;
    const els = toc.map((h) => document.getElementById(h.id)).filter((x): x is HTMLElement => !!x);
    const io = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.id);
    }, { rootMargin: "-80px 0px -65% 0px" });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [toc, generation]);

  return { toc, activeHeading };
}

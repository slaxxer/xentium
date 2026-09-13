/**
 * The composer's four popovers: block picker, overflow tray, link editor, emoji.
 *
 * ⚠ All four anchor to the ACTION BAR, which is at the bottom of the surface, so all
 * four open UPWARDS. That is the one thing they have in common and the reason they
 * live together.
 *
 * ⚠ Each closes on Escape and on a click outside — `useDismiss`. A popover you can
 * only close by completing it is how a toolbar becomes a trap.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import { FontAwesomeIcon } from "../Icon";
import { faCheck, faLink } from "@fortawesome/free-solid-svg-icons";
import {
  COMPOSER_TOOLS, COMPOSER_BLOCKS, currentBlock, type ComposerBlockId,
} from "./composerTools";
import type { ComposerToolId, ResolvedComposerTool } from "@nodevo/contracts";

/** Escape, or a click anywhere outside, closes it. */
function useDismiss(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    // ⚠ `mousedown`, and on the NEXT tick: the click that opened this popover is
    // still travelling, and listening immediately closes it again at once.
    const id = window.setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);
  return ref;
}

function Popover({ children, wide, onClose }: { children: ReactNode; wide?: boolean; onClose: () => void }) {
  const ref = useDismiss(onClose);
  return (
    <div ref={ref} className={`nvc-pop${wide ? " nvc-pop--wide" : ""}`} role="dialog">
      {children}
    </div>
  );
}

/* ── Block picker ─────────────────────────────────────────────────────────── */

/**
 * One control for Text / H1 / H2 / H3 / Quote / Code.
 *
 * ⚠ It shows what you are IN, which seven separate buttons could not: the old bar
 * had three heading toggles whose active state was the only clue, and no way to read
 * "I am in a quote" at a glance.
 */
export function BlockPicker({ editor, disabled }: { editor: Editor | null; disabled?: boolean }) {
  const { t } = useTranslation("common");
  const [open, setOpen] = useState(false);
  const active: ComposerBlockId = currentBlock(editor);

  return (
    <div className="nvc-blockpick">
      <button
        type="button"
        className={`nvc-bar__block${open ? " is-on" : ""}`}
        disabled={disabled || !editor}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{t(`composer.block.${active}`)}</span>
        <i className="nvc-caret" aria-hidden />
      </button>

      {open && (
        <Popover onClose={() => setOpen(false)}>
          <div className="nvc-pop__label">{t("composer.blockLabel")}</div>
          {COMPOSER_BLOCKS.map((b) => (
            <button
              key={b.id}
              type="button"
              className={`nvc-pop__row${editor && b.isActive(editor) ? " is-on" : ""}`}
              onClick={() => { if (editor) b.run(editor); setOpen(false); }}
            >
              <span className={`nvc-blockglyph nvc-blockglyph--${b.id}`}>
                {t(`composer.blockGlyph.${b.id}`)}
              </span>
              {t(`composer.block.${b.id}`)}
            </button>
          ))}
          <button
            type="button"
            className="nvc-pop__row"
            onClick={() => {
              if (editor) COMPOSER_TOOLS.divider.run?.(editor);
              setOpen(false);
            }}
          >
            <span className="nvc-blockglyph">—</span>
            {t("composer.tool.divider")}
          </button>
        </Popover>
      )}
    </div>
  );
}

/* ── Overflow tray ───────────────────────────────────────────────────────── */

const GROUP_ORDER = ["marks", "blocks", "align", "insert"] as const;

/**
 * Everything not in the bar, grouped.
 *
 * ⚠ Grouped by what the tool DOES, not by what fits: an admin can move any tool
 * into the bar, so the tray's contents change per site and a hand-built layout
 * would go wrong the moment they did.
 */
export function OverflowTray({
  editor, tools, onClose, onTool,
}: {
  editor: Editor | null;
  tools:  ResolvedComposerTool[];
  onClose: () => void;
  /** For the tools the composer owns (link, attach, emoji, mention). */
  onTool: (id: ComposerToolId) => void;
}) {
  const { t } = useTranslation("common");
  const inTray = tools.filter((x) => x.where === "overflow");

  return (
    <Popover wide onClose={onClose}>
      {GROUP_ORDER.map((group) => {
        const rows = inTray.filter((x) => x.group === group);
        if (rows.length === 0) return null;
        return (
          <div key={group}>
            <div className="nvc-pop__label">{t(`composer.group.${group}`)}</div>
            <div className="nvc-pop__grid">
              {rows.map(({ id }) => {
                const tool = COMPOSER_TOOLS[id];
                const on = !!(editor && tool.isActive?.(editor));
                const can = !editor || !tool.enabled || tool.enabled(editor);
                return (
                  <button
                    key={id}
                    type="button"
                    title={t(`composer.tool.${id}`)}
                    aria-label={t(`composer.tool.${id}`)}
                    className={`nvc-pop__cell${on ? " is-on" : ""}`}
                    disabled={!can}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      if (tool.run && editor) { tool.run(editor); onClose(); }
                      else onTool(id);
                    }}
                  >
                    <FontAwesomeIcon className="nvc-ic" icon={tool.icon} />
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <p className="nvc-pop__foot">{t("composer.trayFoot")}</p>
    </Popover>
  );
}

/* ── Link editor ─────────────────────────────────────────────────────────── */

/**
 * ⚠ This replaces `window.prompt()`.
 *
 * The prompt could not show the current href, could not offer "open in new tab",
 * could not be styled, and on some browsers is suppressed entirely — in which case
 * the link button silently did nothing at all.
 */
export function LinkPopover({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const { t } = useTranslation("common");
  const existing = editor.getAttributes("link");
  const [href, setHref] = useState<string>((existing.href as string) ?? "");
  const [blank, setBlank] = useState<boolean>(existing.target !== "_self");
  const hadLink = !!existing.href;

  const apply = () => {
    const url = href.trim();
    if (!url) { editor.chain().focus().unsetLink().run(); onClose(); return; }
    editor.chain().focus()
      .setLink({ href: url, target: blank ? "_blank" : "_self" })
      .run();
    onClose();
  };

  return (
    <Popover wide onClose={onClose}>
      <div className="nvc-pop__label">{t("composer.tool.link")}</div>
      <div className="nvc-linkfield">
        <FontAwesomeIcon className="nvc-ic" icon={faLink} />
        <input
          autoFocus
          value={href}
          placeholder="https://"
          aria-label={t("composer.linkUrl")}
          onChange={(e) => setHref(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); apply(); }
          }}
        />
      </div>
      <label className="nvc-linkopt">
        <span className={`nvc-check${blank ? " is-on" : ""}`} aria-hidden>
          {blank && <FontAwesomeIcon className="nvc-ic" icon={faCheck} />}
        </span>
        <input
          type="checkbox"
          checked={blank}
          onChange={(e) => setBlank(e.target.checked)}
        />
        {t("composer.linkNewTab")}
      </label>
      <div className="nvc-pop__acts">
        {/* Only offered when there IS a link to remove. */}
        {hadLink && (
          <button type="button" className="nvc-btn" onClick={() => {
            editor.chain().focus().unsetLink().run();
            onClose();
          }}>
            {t("composer.linkRemove")}
          </button>
        )}
        <button type="button" className="nvc-btn nvc-btn--primary" onClick={apply}>
          {t("composer.linkApply")}
        </button>
      </div>
    </Popover>
  );
}

/* ── Emoji ───────────────────────────────────────────────────────────────── */

/**
 * A curated set, inserted as text.
 *
 * ⚠ No dependency and no picker library: emoji are characters, the editor already
 * stores unicode, and an emoji-data package is ~1 MB for a grid. GIFs and stickers
 * (the design's other two tabs) need an external service and an API key — there is
 * no Tenor integration, so the tab that cannot work is not drawn. See `docs`.
 */
const EMOJI: Record<string, string[]> = {
  common: ["👍", "🎉", "🔥", "✅", "👀", "🙏", "😂", "🤔", "❤️", "😅", "💯", "🚀"],
  faces:  ["😀", "😉", "😍", "😎", "🙃", "😴", "😭", "😡", "🤯", "🥳", "😬", "🤗"],
  hands:  ["👋", "🤝", "👏", "🙌", "💪", "✌️", "🤞", "👌", "🫡", "🤙", "☝️", "👇"],
  things: ["💡", "📌", "📎", "🔧", "🐛", "📦", "⚠️", "⭐", "🏆", "🎯", "⏰", "🔒"],
};

export function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const { t } = useTranslation("common");
  const [query, setQuery] = useState("");

  // Searching flattens the groups: with a query, "which group" stops being useful.
  const groups = query.trim()
    ? { search: Object.values(EMOJI).flat() }
    : EMOJI;

  return (
    <Popover wide onClose={onClose}>
      <input
        className="nvc-emoji__search"
        autoFocus
        value={query}
        placeholder={t("composer.emojiSearch")}
        aria-label={t("composer.emojiSearch")}
        onChange={(e) => setQuery(e.target.value)}
      />
      {Object.entries(groups).map(([group, list]) => (
        <div key={group}>
          {group !== "search" && (
            <div className="nvc-pop__label">{t(`composer.emojiGroup.${group}`)}</div>
          )}
          <div className="nvc-emoji__grid">
            {list.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="nvc-emoji__cell"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onPick(emoji); onClose(); }}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      ))}
    </Popover>
  );
}

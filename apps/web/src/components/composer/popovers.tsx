/**
 * The composer's four popovers: block picker, overflow tray, link editor, emoji.
 *
 * ⚠ All four anchor to the ACTION BAR, which is at the bottom of the surface, so all
 * four open UPWARDS (downwards only when there is no room above). They are drawn in
 * <body> (see `Popover`) so no clipping ancestor can cut them off.
 *
 * ⚠ Each closes on Escape and on a click outside — `useDismiss`. A popover you can
 * only close by completing it is how a toolbar becomes a trap.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import { FontAwesomeIcon } from "../Icon";
import { faCheck, faLink } from "@fortawesome/free-solid-svg-icons";
import {
  COMPOSER_TOOLS, COMPOSER_BLOCKS, currentBlock, type ComposerBlockId,
} from "./composerTools";
import { CorePermissions, type ComposerToolId, type EmojiRow, type ResolvedComposerTool } from "@xentium/contracts";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useAuth } from "../../hooks/useAuth";
import { userCan } from "../../lib/authStore";

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

/** How far a popover keeps from its button and from the window's edges. */
const GAP = 6;
const EDGE = 8;

/**
 * A composer popover, drawn at the top of the page and placed by its button.
 *
 * ⚠ PORTALLED. Inside the surface it was clipped by any ancestor that clips — the
 * forum's reply card and post cards do (`overflow: hidden`) — so the More tools tray
 * opened with its top cut off. It now lives in <body>, fixed to the spot its button is
 * on screen: upwards as before (the bar is at the bottom of the surface), downwards
 * when there is no room above, and pushed back inside the window at the sides. It
 * follows the page while it is open.
 *
 * The anchor is the element the popover is rendered INTO (its parent in the composer's
 * markup — the More button's wrapper, the block picker, the dock), found through a
 * zero-size marker left in its place.
 */
function Popover({ children, wide, onClose }: { children: ReactNode; wide?: boolean; onClose: () => void }) {
  const ref = useDismiss(onClose);
  const marker = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const anchor = marker.current?.parentElement;
      const pop = ref.current;
      if (!anchor || !pop) return;
      const a = anchor.getBoundingClientRect();
      const { width, height } = pop.getBoundingClientRect();
      const left = Math.max(EDGE, Math.min(a.left, window.innerWidth - width - EDGE));
      const roomAbove = a.top - GAP - EDGE;
      const roomBelow = window.innerHeight - a.bottom - GAP - EDGE;
      setPos(height <= roomAbove || roomAbove >= roomBelow
        ? { left, bottom: window.innerHeight - a.top + GAP }
        : { left, top: a.bottom + GAP });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [ref]);

  return (
    <>
      <span ref={marker} hidden />
      {createPortal(
        <div
          ref={ref}
          className={`nvc-pop nvc-pop--floating${wide ? " nvc-pop--wide" : ""}`}
          role="dialog"
          // Measured on the first pass (invisible), then placed.
          style={pos
            ? { position: "fixed", left: pos.left, top: pos.top ?? "auto", bottom: pos.bottom ?? "auto" }
            : { position: "fixed", left: 0, top: 0, visibility: "hidden" }}
        >
          {children}
        </div>,
        document.body,
      )}
    </>
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
 * The site's OWN emojis — the images an admin uploaded (ACP → Content → Emojis),
 * grouped by their category. There is no built-in set: what a community can post is
 * the community's call. With none configured the picker says so, and points an admin
 * at the page.
 */
export function useSiteEmojis() {
  return useQuery({
    queryKey: ["emojis"],
    queryFn: () => api.get<EmojiRow[]>("/emojis"),
    staleTime: 5 * 60_000,
  });
}

export function EmojiPicker({ onPick, onClose }: { onPick: (emoji: EmojiRow) => void; onClose: () => void }) {
  const { t } = useTranslation("common");
  const { user } = useAuth();
  const { data: emojis = [], isLoading } = useSiteEmojis();

  // In the order the server sends (category, then position).
  const groups = new Map<string, EmojiRow[]>();
  for (const e of emojis) groups.set(e.category, [...(groups.get(e.category) ?? []), e]);

  return (
    <Popover wide onClose={onClose}>
      {!isLoading && emojis.length === 0 && (
        <p className="nvc-emoji__none">
          {t("composer.emojiNone")}
          {userCan(user, CorePermissions.EMOJI_MANAGE) && (
            <> <a href="/admin/emojis">{t("composer.emojiManage")}</a></>
          )}
        </p>
      )}
      {[...groups.entries()].map(([group, list]) => (
        <div key={group || "_"}>
          {emojis.some((e) => e.category) && (
            <div className="nvc-pop__label">{group || t("composer.emojiOther")}</div>
          )}
          <div className="nvc-emoji__grid">
            {list.map((emoji) => (
              <button
                key={emoji.id}
                type="button"
                className="nvc-emoji__cell"
                title={`:${emoji.shortcode}:`}
                aria-label={emoji.name}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onPick(emoji); onClose(); }}
              >
                <img src={emoji.url} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      ))}
    </Popover>
  );
}

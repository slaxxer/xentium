/**
 * The profile miniature: hover a username or an avatar anywhere and a small card
 * shows who that is.
 *
 * ONE listener for the whole document, so every surface gets it without being touched
 * — core pages, plugin pages, the forum. A trigger is any link to a profile
 * (`/u/<name>`) or anything carrying `data-user-card="<name>"` (avatars that are not
 * links). `data-no-user-card` on an ancestor opts a region out: the account menu, the
 * card itself, dropdowns.
 *
 * Mouse only. A touch has no hover, and a tap must keep following the link.
 *
 * The profile is read with `?preview=1`, which records no visit (a glance is not one),
 * and under its own query key, so opening the real profile afterwards still counts.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { useDateTime } from "../lib/datetime";
import { Avatar } from "./Avatar";
import { Username } from "./Username";
import "./UserHoverCard.scss";

interface CardProfile {
  username: string;
  displayName: string | null;
  namePreference?: "username" | "fullName";
  avatar: string | null;
  coverImage: string | null;
  groups: { key: string; name: string; badgeColor: string | null; badgeLabel: string | null }[];
  postCount: number;
  followerCount: number;
  likeCountReceived: number;
  joinedDate: string;
  online?: boolean;
  isBanned?: boolean;
}

const OPEN_DELAY = 450;
const CLOSE_DELAY = 180;
const WIDTH = 300;
const PROFILE_HREF = /^\/u\/([^/?#]+)/;

/** The username a hovered element stands for, or null. */
function triggerOf(target: EventTarget | null): { el: HTMLElement; username: string } | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest<HTMLElement>("[data-user-card], a[href^='/u/']");
  // Not in the header's own account menu or any open dropdown: those are menus.
  if (!el || el.closest("[data-no-user-card], .xt-account, .pub-nav__user-menu, .xt-pop")) return null;
  const named = el.getAttribute("data-user-card");
  if (named) return { el, username: named };
  const m = PROFILE_HREF.exec(el.getAttribute("href") ?? "");
  if (!m) return null;
  try { return { el, username: decodeURIComponent(m[1]!) }; } catch { return null; }
}

/** Below the trigger, or above it when there is no room; always inside the window. */
function placeFor(rect: DOMRect): { top: number; left: number; above: boolean } {
  const above = window.innerHeight - rect.bottom < 260 && rect.top > 260;
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - WIDTH - 8);
  return { top: above ? rect.top - 8 : rect.bottom + 8, left, above };
}

export function UserHoverCardHost() {
  const [open, setOpen] = useState<{ username: string; top: number; left: number; above: boolean } | null>(null);
  const openTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);
  const current = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Mouse only, decided per event (`pointerType`): a laptop with a touch screen gets
    // the card for its trackpad and none for a tap.
    const clear = () => { window.clearTimeout(openTimer.current); window.clearTimeout(closeTimer.current); };
    const scheduleClose = () => {
      window.clearTimeout(openTimer.current);
      window.clearTimeout(closeTimer.current);
      closeTimer.current = window.setTimeout(() => { current.current = null; setOpen(null); }, CLOSE_DELAY);
    };

    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      if ((e.target as Element | null)?.closest?.(".xt-user-card")) { window.clearTimeout(closeTimer.current); return; }
      const t = triggerOf(e.target);
      if (!t) return;
      if (t.el === current.current) { window.clearTimeout(closeTimer.current); return; }
      clear();
      openTimer.current = window.setTimeout(() => {
        if (!t.el.isConnected) return;
        current.current = t.el;
        setOpen({ username: t.username, ...placeFor(t.el.getBoundingClientRect()) });
      }, OPEN_DELAY);
    };
    const onOut = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const to = e.relatedTarget as Element | null;
      const from = (e.target as Element | null)?.closest?.(".xt-user-card") ?? triggerOf(e.target)?.el;
      if (!from) return;
      // Moving within the trigger, or onto the card, keeps it.
      if (to && (from.contains(to) || to.closest?.(".xt-user-card"))) return;
      if (to && current.current && current.current.contains(to)) return;
      scheduleClose();
    };
    const shut = () => { clear(); current.current = null; setOpen(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") shut(); };
    // A click (following the link) ends the glance.
    const onDown = (e: PointerEvent) => { if (!(e.target as Element | null)?.closest?.(".xt-user-card")) shut(); };

    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerout", onOut);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", shut, { passive: true, capture: true });
    document.addEventListener("pointerdown", onDown);
    return () => {
      clear();
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("scroll", shut, { capture: true });
    };
  }, []);

  if (!open) return null;
  return createPortal(
    <UserHoverCard username={open.username} style={{
      left: open.left, width: WIDTH,
      ...(open.above ? { bottom: window.innerHeight - open.top } : { top: open.top }),
    }} />,
    document.body,
  );
}

function UserHoverCard({ username, style }: { username: string; style: React.CSSProperties }) {
  const { t } = useTranslation("common");
  const dt = useDateTime();
  const { data: p, isError } = useQuery<CardProfile>({
    queryKey: ["user-card", username.toLowerCase()],
    queryFn: () => api.get(`/users/${encodeURIComponent(username)}?preview=1`),
    staleTime: 60_000,
    retry: false,
  });
  if (isError) return null;

  const group = p?.groups[0];
  const shown = p && p.namePreference === "fullName" && p.displayName ? p.displayName : null;
  const href = `/u/${encodeURIComponent(p?.username ?? username)}`;

  return (
    <div className="xt-user-card" data-no-user-card role="dialog" aria-label={p?.username ?? username} style={style}>
      <div className="xt-user-card__cover"
        style={p?.coverImage ? { backgroundImage: `url("${p.coverImage}")` } : undefined} />
      <div className="xt-user-card__body">
        <div className="xt-user-card__head">
          <Link to={href} className="xt-user-card__ava">
            <Avatar user={{ username: p?.username ?? username, avatar: p?.avatar ?? null }} size={56}
              online={p ? !!p.online : undefined} />
          </Link>
          <div className="xt-user-card__who">
            <Link to={href} className="xt-user-card__name">
              <Username username={p?.username ?? username} badgeColor={group?.badgeColor ?? null} roleKey={group?.key ?? null} />
            </Link>
            {shown && <span className="xt-user-card__handle">{shown}</span>}
            {group && (
              <span className="xt-user-card__group" style={group.badgeColor ? { ["--g" as string]: group.badgeColor } : undefined}>
                {group.badgeLabel ?? group.name}
              </span>
            )}
          </div>
        </div>

        {!p ? (
          <p className="xt-user-card__loading">{t("userCard.loading")}</p>
        ) : (
          <>
            <p className="xt-user-card__meta">
              {p.isBanned && <span className="xt-user-card__banned">{t("userCard.banned")}</span>}
              <span>{t("userCard.memberSince", { date: dt.date(p.joinedDate) })}</span>
            </p>
            <dl className="xt-user-card__stats">
              <div><dt>{t("userCard.posts")}</dt><dd>{p.postCount.toLocaleString()}</dd></div>
              <div><dt>{t("userCard.followers")}</dt><dd>{p.followerCount.toLocaleString()}</dd></div>
              <div><dt>{t("userCard.likes")}</dt><dd>{p.likeCountReceived.toLocaleString()}</dd></div>
            </dl>
            <Link to={href} className="xt-user-card__cta">{t("userCard.viewProfile")}</Link>
          </>
        )}
      </div>
    </div>
  );
}

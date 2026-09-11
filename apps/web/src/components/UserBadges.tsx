/**
 * The one thing that draws a user's badges.
 *
 * ⚠ Core owns this markup so that a PLUGIN surface — the forum's post card, a
 * messaging header — adopts badges with one line and no payload change. The
 * alternative was every card selecting badge rows in its own query, which for the
 * forum means editing raw SQL in a paid plugin every time the shape moves.
 *
 * Self-fetching by design, and batched: see `lib/userBadges.ts`. A card passes a
 * user id and nothing else.
 *
 * Renders NOTHING when the user holds no badges — no empty row, no placeholder. A
 * card must look untouched on a site that has never granted one.
 */
import { useTranslation } from "react-i18next";
import type { AwardedBadge } from "@nodevo/contracts";
import { parseIconToken } from "@nodevo/contracts";
import { TokenIcon } from "./TokenIcon";
import { useUserBadges } from "../lib/userBadges";
import "./UserBadges.scss";

export interface UserBadgesProps {
  userId: string | null | undefined;
  /** Beyond this many, the rest collapse into a "+N". Omit for all of them. */
  max?: number;
  /** `sm` for a dense card, `md` on a profile. */
  size?: "sm" | "md";
  className?: string;
}

/** One badge: its glyph, or a dot when the catalogue entry has none. */
export function BadgeMark({ badge, size = "sm" }: { badge: AwardedBadge; size?: "sm" | "md" }) {
  const { t } = useTranslation("common");
  const icon  = parseIconToken(badge.faIcon);
  const color = badge.color ?? "var(--c-accent)";

  // The note is the admin's reason and belongs in the tooltip under the name; the
  // description is what the badge means and stands in when there is no reason.
  const tip = [badge.name, badge.note ?? badge.description].filter(Boolean).join(" — ");

  return (
    <span
      className={`nv-badge nv-badge--${size}`}
      style={{ "--badge-color": color } as React.CSSProperties}
      title={tip}
      aria-label={t("badges.held", { name: badge.name })}
    >
      {/* ⚠ The dot is for a badge with NO icon at all, not for one whose icon the
          site cannot draw — `TokenIcon` handles its own fallbacks, and swapping in a
          dot behind its back would hide a kit problem from the admin who caused it. */}
      {icon ? <TokenIcon token={badge.faIcon} /> : <span className="nv-badge__dot" />}
    </span>
  );
}

export function UserBadges({ userId, max, size = "sm", className }: UserBadgesProps) {
  const { data: badges } = useUserBadges(userId);
  if (!badges?.length) return null;

  const shown  = max ? badges.slice(0, max) : badges;
  const hidden = badges.length - shown.length;

  return (
    <span className={`nv-badges${className ? ` ${className}` : ""}`}>
      {shown.map((b) => <BadgeMark key={b.id} badge={b} size={size} />)}
      {hidden > 0 && (
        <span className={`nv-badge nv-badge--more nv-badge--${size}`} title={badges.slice(max).map((b) => b.name).join(", ")}>
          +{hidden}
        </span>
      )}
    </span>
  );
}

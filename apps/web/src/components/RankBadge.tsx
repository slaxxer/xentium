import type { ReactNode } from "react";
import { useRankImage } from "../lib/rankImage";
import "./RankBadge.scss";

interface RankBadgeProps {
  /** The group the badge stands for. */
  groupKey: string | null | undefined;
  /** The badge's text — the image's alt and tooltip, so nothing is lost to a screen reader. */
  label: string;
  /** The text badge, exactly as the surface draws it. */
  children: ReactNode;
  className?: string;
}

/**
 * A group's rank, wherever a name shows one: the group's uploaded rank IMAGE when the
 * site displays images and the group has one, otherwise the text badge passed in.
 *
 * Wraps rather than replaces each surface's pill, because every surface styles its
 * pill its own way; this only decides which of the two to draw.
 */
export function RankBadge({ groupKey, label, children, className }: RankBadgeProps) {
  const src = useRankImage(groupKey);
  if (!src) return <>{children}</>;
  return (
    <img
      className={`xt-rankimg${className ? ` ${className}` : ""}`}
      src={src}
      alt={label}
      title={label}
      loading="lazy"
      decoding="async"
    />
  );
}

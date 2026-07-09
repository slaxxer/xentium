import { roleColor } from "../lib/groupBadge";
import { useBadgeShadows } from "../lib/badgeShadow";

interface UsernameProps {
  username:   string;
  badgeColor?: string | null;
  /** Group key — enables the staff colour fallback when badgeColor is absent. */
  roleKey?:   string | null;
  href?:      string;
  className?: string;
  style?:     React.CSSProperties;
}

/**
 * Renders a username styled with the user's group badge colour. Falls back to
 * the system-staff palette (admin → coral, mod → violet) via roleKey when the
 * group has no explicit badge colour.
 * Renders as <a> when href is provided, otherwise <span>.
 */
export function Username({ username, badgeColor, roleKey, href, className, style }: UsernameProps) {
  const color = roleColor(badgeColor, roleKey);
  // Groups with the ACP badge "glow" enabled add a text-shadow (admin-configured
  // colour + offsets) so those names stand out everywhere the component renders.
  const shadows = useBadgeShadows();
  const textShadow = color ? shadows.get(color.toLowerCase()) : undefined;
  const colorStyle: React.CSSProperties = {
    ...(color ? { color } : {}),
    ...(textShadow ? { textShadow } : {}),
    ...style,
  };

  if (href) {
    return (
      <a href={href} className={className} style={colorStyle}>
        {username}
      </a>
    );
  }
  return (
    <span className={className} style={colorStyle}>
      {username}
    </span>
  );
}

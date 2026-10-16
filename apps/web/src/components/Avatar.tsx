import { useTranslation } from "react-i18next";
import "./Avatar.scss";

/**
 * Identity colours: one solid, deep colour per member, picked deterministically
 * from the username. Deep enough that white initials keep 4.5:1 on every one. Flat on
 * purpose — the core look has no gradients.
 */
const IDENTITY: string[] = [
  "#0d7c72", "#3f5a8a", "#8a3f5c", "#6b5a2e", "#b4532a", "#4d6b3a", "#7a3b69", "#2f5f6e", "#5a4a3a",
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** A member's identity colour. */
export function identityColour(username: string): string {
  return IDENTITY[hashStr(username) % IDENTITY.length]!;
}

function initials(name: string): string {
  return (
    name
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

interface AvatarProps {
  user: { username: string; avatar?: string | null };
  size?: number;
  online?: boolean;
  /** Override the presence dot diameter (px). Defaults to 28% of size, capped at 16px. */
  presenceSize?: number;
  className?: string;
}

/**
 * Avatar: a solid circle with white initials, its colour derived deterministically
 * from the username so each member has a stable colour.
 * Optional green presence dot (ring-cut against the card) signals online.
 */
export function Avatar({ user, size = 38, online, presenceSize, className }: AvatarProps) {
  const box: React.CSSProperties = { width: size, height: size };
  const dot = presenceSize ?? Math.min(16, Math.round(size * 0.28));
  const colour = identityColour(user.username);
  const { t } = useTranslation("common");

  return (
    <div className={`hearth-ava-wrap${className ? ` ${className}` : ""}`} style={box} data-user-card={user.username}>
      {user.avatar ? (
        <img className="hearth-ava hearth-ava--img" src={user.avatar} alt={user.username} style={box} />
      ) : (
        <div
          className="hearth-ava"
          style={{ ...box, fontSize: size * 0.4, background: colour }}
          aria-label={user.username}
        >
          {initials(user.username)}
        </div>
      )}
      {online !== undefined && (
        <span
          className={`hearth-ava__pres ${online ? "is-online" : "is-offline"}`}
          style={{ width: dot, height: dot }}
          aria-label={t(online ? "presence.online" : "presence.offline")}
        >
          {online && <span className="hearth-ava__pulse" aria-hidden />}
        </span>
      )}
    </div>
  );
}

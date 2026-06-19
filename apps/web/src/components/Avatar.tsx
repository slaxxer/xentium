import "./Avatar.scss";

/** Identity gradient stop-pairs (Nebula reference set). Picked deterministically by id. */
const GRADIENTS: [string, string][] = [
  ["#5865f2", "#7c84ff"],
  ["#00b1cf", "#2bd4ee"],
  ["#2bd4ee", "#5865f2"],
  ["#23a55a", "#00b1cf"],
  ["#5b8def", "#7c84ff"],
  ["#34d399", "#2bd4ee"],
  ["#7c84ff", "#5865f2"],
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** The deterministic two-stop gradient for a username — reuse for cover bands
    so a member's cover matches their avatar. */
export function avatarGradient(username: string): [string, string] {
  return GRADIENTS[hashStr(username) % GRADIENTS.length]!;
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
 * Hearth avatar: a gradient-filled circle with white initials, the gradient
 * derived deterministically from the username so each user has a stable colour.
 * Optional green presence dot (ring-cut against the card) signals online.
 */
export function Avatar({ user, size = 38, online, presenceSize, className }: AvatarProps) {
  const box: React.CSSProperties = { width: size, height: size };
  const dot = presenceSize ?? Math.min(16, Math.round(size * 0.28));
  const [a, b] = GRADIENTS[hashStr(user.username) % GRADIENTS.length]!;

  return (
    <div className={`hearth-ava-wrap${className ? ` ${className}` : ""}`} style={box}>
      {user.avatar ? (
        <img className="hearth-ava hearth-ava--img" src={user.avatar} alt={user.username} style={box} />
      ) : (
        <div
          className="hearth-ava"
          style={{ ...box, fontSize: size * 0.4, background: `linear-gradient(140deg, ${a}, ${b})` }}
          aria-label={user.username}
        >
          {initials(user.username)}
        </div>
      )}
      {online !== undefined && (
        <span
          className={`hearth-ava__pres ${online ? "is-online" : "is-offline"}`}
          style={{ width: dot, height: dot }}
          aria-label={online ? "online" : "offline"}
        >
          {online && <span className="hearth-ava__pulse" aria-hidden />}
        </span>
      )}
    </div>
  );
}

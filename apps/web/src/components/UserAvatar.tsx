interface UserAvatarProps {
  user: { username: string; avatar?: string | null };
  size?: number;
  className?: string;
}

export function UserAvatar({ user, size = 36, className }: UserAvatarProps) {
  const initials = user.username
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const style: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: "50%",
    flexShrink: 0,
  };

  if (user.avatar) {
    return (
      <img
        src={user.avatar}
        alt={user.username}
        style={{ ...style, objectFit: "cover" }}
        className={className}
        data-user-card={user.username}
      />
    );
  }

  return (
    <div
      className={`ua-initials${className ? ` ${className}` : ""}`}
      style={{ ...style, fontSize: size * 0.36 }}
      aria-label={user.username}
      data-user-card={user.username}
    >
      {initials}
    </div>
  );
}

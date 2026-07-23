// The one status-pill badge (previously copy-pasted per ACP page).
export function Badge({ label, color = "var(--c-accent)" }: { label: string; color?: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 700, background: `${color}20`, color }}>
      {label}
    </span>
  );
}

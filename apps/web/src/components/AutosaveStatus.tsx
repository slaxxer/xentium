/** Header status indicator for auto-saving ACP config pages. */
export function AutosaveStatus({ saving }: { saving: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 600 }} aria-live="polite">
      <span
        style={{
          width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
          background: saving ? "var(--c-accent)" : "var(--c-success)",
        }}
      />
      <span style={{ color: saving ? "var(--c-accent)" : "var(--c-fg-muted)" }}>
        {saving ? "Saving…" : "Changes save automatically"}
      </span>
    </div>
  );
}

import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";

export interface GroupItem {
  id: string;
  name: string;
  key: string;
}

export interface GroupAccessValue {
  visibility: "public" | "members" | "level" | "groups";
  visibilityGroups: string[];
  visibilityMinLevel: number | null;
  hideIfNoAccess: boolean;
}

interface GroupAccessPickerProps {
  value: GroupAccessValue;
  onChange: (value: GroupAccessValue) => void;
  groups: GroupItem[];
  inheritedRestriction?: string | null;
}

const STAFF_KEYS = ["administrator", "supermod", "moderator"];

// Labels live in the host's `common:groupAccess.*`, keyed by the mode itself.
const MODES: GroupAccessValue["visibility"][] = ["public", "members", "level", "groups"];

const ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 0",
  borderBottom: "1px solid var(--c-border)",
  cursor: "pointer",
};

export function GroupAccessPicker({
  value,
  onChange,
  groups,
  inheritedRestriction,
}: GroupAccessPickerProps) {
  const { t } = useTranslation("common");
  function set(patch: Partial<GroupAccessValue>) {
    onChange({ ...value, ...patch });
  }

  function toggleGroup(id: string) {
    const next = value.visibilityGroups.includes(id)
      ? value.visibilityGroups.filter((g) => g !== id)
      : [...value.visibilityGroups, id];
    set({ visibilityGroups: next });
  }

  function applyStaff() {
    set({
      visibility: "groups",
      visibilityGroups: groups.filter((g) => STAFF_KEYS.includes(g.key)).map((g) => g.id),
    });
  }

  function applyAllMembers() {
    set({
      visibility: "groups",
      visibilityGroups: groups.filter((g) => !STAFF_KEYS.includes(g.key)).map((g) => g.id),
    });
  }

  const shortcutStyle: CSSProperties = {
    fontSize: 11, fontWeight: 600,
    padding: "3px 10px",
    background: "var(--c-surface)",
    border: "1px solid var(--c-border)",
    borderRadius: 100,
    color: "var(--c-fg-muted)",
    cursor: "pointer",
    fontFamily: "inherit",
  };

  return (
    <div>
      {/* Visibility mode radio buttons */}
      <div style={{ marginBottom: 10 }}>
        {MODES.map((mode, i) => (
          <label
            key={mode}
            style={{
              ...ROW,
              borderBottom: i < MODES.length - 1 ? "1px solid var(--c-border)" : "none",
            }}
          >
            <input
              type="radio"
              name="gap-vis"
              checked={value.visibility === mode}
              onChange={() =>
                set({
                  visibility: mode,
                  visibilityGroups:
                    mode !== "groups" ? [] : value.visibilityGroups,
                })
              }
              style={{ accentColor: "var(--c-accent)", flexShrink: 0 }}
            />
            <span style={{ fontSize: 13, color: "var(--c-fg)" }}>{t(`groupAccess.${mode}`)}</span>
            {mode === "level" && value.visibility === "level" && (
              <input
                type="number"
                min={1}
                max={10}
                value={value.visibilityMinLevel ?? 1}
                onChange={(e) =>
                  set({ visibilityMinLevel: Math.max(1, Number(e.target.value)) })
                }
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: 56,
                  padding: "2px 6px",
                  marginLeft: 4,
                  background: "var(--c-surface)",
                  border: "1px solid var(--c-border)",
                  borderRadius: 6,
                  color: "var(--c-fg)",
                  fontSize: 13,
                  fontFamily: "inherit",
                }}
              />
            )}
          </label>
        ))}
      </div>

      {/* Group list + shortcuts — only when groups mode is active */}
      {value.visibility === "groups" && (
        <>
          <div
            style={{
              border: "1px solid var(--c-border)",
              borderRadius: 8,
              overflow: "hidden",
              marginBottom: 8,
              maxHeight: 220,
              overflowY: "auto",
            }}
          >
            {groups.length === 0 ? (
              <div style={{ padding: "12px 14px", fontSize: 13, color: "var(--c-fg-muted)" }}>
                {t("groupAccess.noGroups")}
              </div>
            ) : (
              groups.map((g, i) => {
                const checked = value.visibilityGroups.includes(g.id);
                return (
                  <label
                    key={g.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "9px 14px",
                      borderBottom:
                        i < groups.length - 1 ? "1px solid var(--c-border)" : "none",
                      cursor: "pointer",
                      fontSize: 13,
                      background: checked ? "var(--c-accent-soft)" : "transparent",
                      transition: "background 0.12s",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleGroup(g.id)}
                      style={{ accentColor: "var(--c-accent)" }}
                    />
                    <span
                      style={{
                        flex: 1,
                        fontWeight: checked ? 600 : 400,
                        color: "var(--c-fg)",
                      }}
                    >
                      {g.name}
                    </span>
                    <code style={{ fontSize: 11, color: "var(--c-fg-muted)" }}>{g.key}</code>
                  </label>
                );
              })
            )}
          </div>

          {/* Shortcuts */}
          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--c-fg-muted)", letterSpacing: "0.06em" }}>
              {t("groupAccess.shortcuts").toUpperCase()}
            </span>
            <button type="button" style={shortcutStyle} onClick={applyStaff}>
              {t("groupAccess.staff")}
            </button>
            <button type="button" style={shortcutStyle} onClick={applyAllMembers}>
              {t("groupAccess.allMembers")}
            </button>
          </div>

          {/* Hide if no access */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--c-fg-muted)" }}>
              {t("groupAccess.ifNoAccess")}
            </span>
            {[
              { val: true,  label: t("groupAccess.hide") },
              { val: false, label: t("groupAccess.locked") },
            ].map(({ val, label }) => (
              <label
                key={String(val)}
                style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13, color: "var(--c-fg)" }}
              >
                <input
                  type="radio"
                  name="gap-hide"
                  checked={value.hideIfNoAccess === val}
                  onChange={() => set({ hideIfNoAccess: val })}
                  style={{ accentColor: "var(--c-accent)" }}
                />
                {label}
              </label>
            ))}
          </div>
        </>
      )}

      {/* Inherited restriction warning */}
      {inheritedRestriction && (
        <div
          style={{
            marginTop: 12,
            padding: "8px 12px",
            background: "rgba(251,191,36,.1)",
            border: "1px solid rgba(251,191,36,.3)",
            borderRadius: 8,
            fontSize: 12,
            color: "var(--c-warn)",
          }}
        >
          ⚠ {t("groupAccess.inheritedLabel")}{" "}
          <strong>{inheritedRestriction}</strong>. {t("groupAccess.inheritedBody")}
        </div>
      )}
    </div>
  );
}

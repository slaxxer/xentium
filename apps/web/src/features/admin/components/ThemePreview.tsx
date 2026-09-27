import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "../../../components/Icon";
import { faSun, faMoon } from "@fortawesome/free-solid-svg-icons";

/**
 * A theme from the marketplace, rendered BY the marketplace, shown before install.
 *
 * Installing a theme is the most sweeping change the ACP offers — it restages the
 * arrangement of every page at once — and until now the only way to find out what
 * one looked like was to do it. That cannot be fixed by letting an instance "try"
 * a theme it has not bought: a theme is data with no runtime, so anything staged
 * for a trial is the theme, permanently, on that admin's disk. The marketplace
 * draws it instead and serves markup.
 *
 * ⚠ The document comes from a stranger's package. The route already sends a CSP
 * that sandboxes it and forbids scripts; the `sandbox` attribute below is a SECOND
 * lock, placed where the embedding happens so it cannot be lost if that route is
 * ever refactored. Neither is sufficient reason to drop the other.
 */
export function ThemePreview({ name, base, templates }: {
  name:      string;
  /** Absolute, from the catalogue — the marketplace serves this, not the instance. */
  base:      string;
  templates: string[];
}) {
  const { t } = useTranslation("acp");
  const [template, setTemplate] = useState(templates[0] ?? "");
  const [scheme, setScheme]     = useState<"light" | "dark">("light");

  if (!templates.length) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {templates.map((key) => (
            <button
              key={key}
              type="button"
              className={`btn-ghost btn-sm${key === template ? " is-active" : ""}`}
              style={key === template
                ? { color: "var(--c-accent)", borderColor: "var(--c-accent)", background: "var(--c-accent-soft)" }
                : undefined}
              onClick={() => setTemplate(key)}
            >
              {/* The registry key itself. A friendly name would be a second list to
                  keep in step with the template set, and the key is what the Layout
                  Editor's own picker shows. */}
              {key}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {(["light", "dark"] as const).map((s) => (
            <button
              key={s}
              type="button"
              className="btn-ghost btn-sm"
              aria-pressed={s === scheme}
              style={s === scheme ? { color: "var(--c-accent)", borderColor: "var(--c-accent)" } : undefined}
              onClick={() => setScheme(s)}
            >
              <FontAwesomeIcon icon={s === "light" ? faSun : faMoon} />
            </button>
          ))}
        </div>
      </div>

      <iframe
        key={`${template}-${scheme}`}
        sandbox=""
        loading="lazy"
        title={`${name} — ${template}`}
        src={`${base}/${encodeURIComponent(template)}?scheme=${scheme}`}
        style={{
          display: "block", width: "100%", height: 460, border: "1px solid var(--c-border)",
          borderRadius: "var(--radius-md)", background: "var(--c-surface)",
        }}
      />

      <p style={{ margin: 0, fontSize: "var(--fs-xs)", lineHeight: 1.6, color: "var(--c-fg-muted)" }}>
        {t("marketplace.previewNote")}
      </p>
    </div>
  );
}

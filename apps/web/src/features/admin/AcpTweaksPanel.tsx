import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AcpIcon } from "./pages/acpIcons";
import { ACP_ACCENTS, type AcpTweaks } from "./useAcpTweaks";

// Floating ACP "Tweaks" panel — per-admin chrome preferences persisted to
// localStorage (see useAcpTweaks). Toggled by a fixed gear button bottom-right.

interface SegOption<T extends string> { value: T; label: string }

function Seg<T extends string>({ value, options, onChange }: {
  value: T; options: SegOption<T>[]; onChange: (v: T) => void;
}) {
  return (
    <div className="tweakseg" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? "is-on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function AcpTweaksPanel({ tweaks, setTweak }: {
  tweaks: AcpTweaks;
  setTweak: <K extends keyof AcpTweaks>(key: K, value: AcpTweaks[K]) => void;
}) {
  const { t } = useTranslation("acp");
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={`tweakfab${open ? " is-active" : ""}`}
        title={t("tweaks.title", "Tweaks")}
        aria-label={t("tweaks.title", "Tweaks")}
        onClick={() => setOpen((o) => !o)}
      >
        <AcpIcon name="cog" size={18} />
      </button>

      {open && (
        <div className="tweakpanel" role="dialog" aria-label={t("tweaks.title", "Tweaks")}>
          <div className="tweakpanel__head">
            <b>{t("tweaks.title", "Tweaks")}</b>
            <button type="button" className="tweakpanel__x" aria-label="Close" onClick={() => setOpen(false)}>✕</button>
          </div>

          <div className="tweakpanel__body">
            <div className="tweakpanel__sect">{t("tweaks.navigation", "Navigation")}</div>
            <label className="tweakpanel__row">
              <span>{t("tweaks.layout", "Layout")}</span>
              <Seg
                value={tweaks.navLayout}
                onChange={(v) => setTweak("navLayout", v)}
                options={[
                  { value: "horizontal", label: t("tweaks.horizontal", "Horizontal") },
                  { value: "sidebar", label: t("tweaks.sidebar", "Sidebar") },
                  { value: "rail", label: t("tweaks.rail", "Rail") },
                ]}
              />
            </label>

            <div className="tweakpanel__sect">{t("tweaks.display", "Display")}</div>
            <label className="tweakpanel__row">
              <span>{t("tweaks.density", "Density")}</span>
              <Seg
                value={tweaks.density}
                onChange={(v) => setTweak("density", v)}
                options={[
                  { value: "comfortable", label: t("tweaks.comfortable", "Comfortable") },
                  { value: "compact", label: t("tweaks.compact", "Compact") },
                ]}
              />
            </label>

            <div className="tweakpanel__sect">{t("tweaks.theme", "Theme")}</div>
            <div className="tweakpanel__row tweakpanel__row--col">
              <span>{t("tweaks.accent", "Accent")}</span>
              <div className="tweakchips" role="radiogroup">
                <button
                  type="button"
                  role="radio"
                  aria-checked={tweaks.accent === ""}
                  className={`tweakchip tweakchip--default${tweaks.accent === "" ? " is-on" : ""}`}
                  title={t("tweaks.accentDefault", "Theme default")}
                  onClick={() => setTweak("accent", "")}
                >
                  {tweaks.accent === "" && <AcpIcon name="check" size={14} />}
                </button>
                {ACP_ACCENTS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={tweaks.accent === c}
                    className={`tweakchip${tweaks.accent === c ? " is-on" : ""}`}
                    style={{ background: c }}
                    title={c}
                    onClick={() => setTweak("accent", c)}
                  >
                    {tweaks.accent === c && <AcpIcon name="check" size={14} />}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

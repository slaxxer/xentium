import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../../hooks/useTheme";
import { useFont, FONTS } from "../../../hooks/useFont";
import { AccordionSection } from "../../../components/AccordionSection";
import { swalToast, apiErrorMessage } from "../../../lib/swal";
import { useAuth, refreshCurrentUser } from "../../../hooks/useAuth";
import { api } from "../../../lib/api";
import i18n, { SUPPORTED_LOCALES, setLocale, type LocaleCode } from "../../../lib/i18n";

const THEMES = [
  { value: "light",  icon: "☀️" },
  { value: "dark",   icon: "🌙" },
  { value: "system", icon: "💻" },
] as const;

interface OtherToggles {
  reduceMotion: boolean;
  compactView: boolean;
  autoPlayMedia: boolean;
}

function Toggle({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="account-toggle">
      <div className="account-toggle__text">
        <span className="account-toggle__label">{label}</span>
        <span className="account-toggle__desc">{desc}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={`account-toggle__btn${checked ? " account-toggle__btn--on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className="account-toggle__knob" />
      </button>
    </label>
  );
}

interface BadgeItem {
  id: string;
  name: string;
  key: string;
  displayOrder: number;
  badgeLabel: string | null;
  badgeColor: string | null;
  visible: boolean;
}

function BadgeVisibility() {
  const [items, setItems] = useState<BadgeItem[] | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.get<BadgeItem[]>("/account/badges")
      .then((data) => { if (alive) setItems(data); })
      .catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, []);

  async function toggle(badge: BadgeItem) {
    if (!items) return;
    const next = items.map((b) => (b.id === badge.id ? { ...b, visible: !b.visible } : b));
    setItems(next);
    setSavingId(badge.id);
    try {
      const hidden = next.filter((b) => !b.visible).map((b) => b.id);
      const fresh = await api.patch<BadgeItem[]>("/account/badges", { hidden });
      setItems(fresh);
      await refreshCurrentUser();   // update MeCard / nav immediately
    } catch (e) {
      setItems(items);              // revert
      swalToast(apiErrorMessage(e));
    } finally {
      setSavingId(null);
    }
  }

  if (items === null) {
    return <div className="security-accordion__content" style={{ color: "var(--c-fg-muted)" }}>Loading…</div>;
  }
  if (items.length === 0) {
    return <div className="security-accordion__content" style={{ color: "var(--c-fg-muted)" }}>You don’t belong to any groups with a badge yet.</div>;
  }

  const visibleCount = items.filter((b) => b.visible).length;

  return (
    <div className="security-accordion__content">
      <p className="account-toggle__desc" style={{ marginBottom: "var(--sp-3)" }}>
        Choose which of your group badges appear next to your name across the site.
        Up to 3 are shown, ordered by group precedence.
        {visibleCount > 3 && " You have more than 3 visible — only the 3 highest-precedence ones will display."}
      </p>
      {items.map((b) => {
        const color = b.badgeColor ?? "var(--c-accent)";
        return (
          <label key={b.id} className="account-toggle">
            <div className="account-toggle__text" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  display: "inline-flex", alignItems: "center",
                  padding: "3px 10px", borderRadius: 999,
                  fontSize: 12, fontWeight: 800, lineHeight: 1.4,
                  background: `${b.badgeColor ?? "#7c6af7"}22`, color,
                }}
              >
                {b.badgeLabel ?? b.name}
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={b.visible}
              disabled={savingId === b.id}
              className={`account-toggle__btn${b.visible ? " account-toggle__btn--on" : ""}`}
              onClick={() => toggle(b)}
            >
              <span className="account-toggle__knob" />
            </button>
          </label>
        );
      })}
    </div>
  );
}

const LS_OTHERS_KEY = "nv_pref_others";

function loadOthers(): OtherToggles {
  try {
    const raw = localStorage.getItem(LS_OTHERS_KEY);
    return raw ? JSON.parse(raw) : { reduceMotion: false, compactView: false, autoPlayMedia: true };
  } catch { return { reduceMotion: false, compactView: false, autoPlayMedia: true }; }
}

export function PreferencesTab() {
  const { t } = useTranslation("account");
  const { preference, setPreference } = useTheme();
  const { font, setFont } = useFont();
  const { user } = useAuth();
  const [locale, setLocaleState] = useState<string>(user?.preferredLocale ?? i18n.language ?? "en");
  const [localeSaving, setLocaleSaving] = useState(false);
  const [others, setOthers] = useState<OtherToggles>(loadOthers);
  const [othersSaving, setOthersSaving] = useState(false);

  async function chooseLocale(code: LocaleCode) {
    setLocaleState(code);
    setLocale(code);              // apply + cookie immediately
    setLocaleSaving(true);
    try {
      await api.patch("/account/profile", { preferredLocale: code });
      if (user) user.preferredLocale = code;
      swalToast(t("preferences.saved"), "success");
    } catch {
      swalToast(t("preferences.languageSaveError"));
    } finally {
      setLocaleSaving(false);
    }
  }

  function patchOther(key: keyof OtherToggles, v: boolean) {
    setOthers((prev) => ({ ...prev, [key]: v }));
  }

  async function handleSaveOthers() {
    setOthersSaving(true);
    try {
      // TODO Phase 8: replace with api.patch("/account/preferences", { others })
      localStorage.setItem(LS_OTHERS_KEY, JSON.stringify(others));
      swalToast(t("preferences.saved"), "success");
    } catch {
      swalToast(t("preferences.saveError"));
    } finally {
      setOthersSaving(false);
    }
  }

  return (
    <section className="account-section">
      <h2 className="account-section__title">{t("preferences.title")}</h2>

      <div className="security-accordion-list">
        <AccordionSection title={t("preferences.theme")} defaultOpen={true}>
          <div className="security-accordion__content">
            <div className="account-theme-grid">
              {THEMES.map((themeOpt) => (
                <button
                  key={themeOpt.value}
                  type="button"
                  className={`account-theme-btn${preference === themeOpt.value ? " account-theme-btn--active" : ""}`}
                  onClick={() => setPreference(themeOpt.value)}
                >
                  <span className="account-theme-btn__icon">{themeOpt.icon}</span>
                  {t(`preferences.themes.${themeOpt.value}`)}
                </button>
              ))}
            </div>
          </div>
        </AccordionSection>

        <AccordionSection title={t("preferences.language")}>
          <div className="security-accordion__content">
            <div className="account-theme-grid">
              {SUPPORTED_LOCALES.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  className={`account-theme-btn${locale.startsWith(l.code) ? " account-theme-btn--active" : ""}`}
                  disabled={localeSaving}
                  onClick={() => chooseLocale(l.code)}
                >
                  <span className="account-theme-btn__icon">{l.code.toUpperCase()}</span>
                  {l.native}
                </button>
              ))}
            </div>
          </div>
        </AccordionSection>

        <AccordionSection title={t("preferences.font")}>
          <div className="security-accordion__content">
            <div className="account-font-grid">
              {FONTS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  className={`account-font-btn${font === f.value ? " account-font-btn--active" : ""}`}
                  style={{ fontFamily: f.stack }}
                  onClick={() => setFont(f.value)}
                >
                  <span className="account-font-btn__name">{f.label}</span>
                  <span className="account-font-btn__desc" style={{ fontFamily: "inherit" }}>{f.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </AccordionSection>

        <AccordionSection title="Badges">
          <BadgeVisibility />
        </AccordionSection>

        <AccordionSection title={t("preferences.other")}>
          <div className="security-accordion__content">
            <Toggle
              label={t("preferences.reduceMotion")}
              desc={t("preferences.reduceMotionDesc")}
              checked={others.reduceMotion}
              onChange={(v) => patchOther("reduceMotion", v)}
            />
            <Toggle
              label={t("preferences.compactView")}
              desc={t("preferences.compactViewDesc")}
              checked={others.compactView}
              onChange={(v) => patchOther("compactView", v)}
            />
            <Toggle
              label={t("preferences.autoPlayMedia")}
              desc={t("preferences.autoPlayMediaDesc")}
              checked={others.autoPlayMedia}
              onChange={(v) => patchOther("autoPlayMedia", v)}
            />
            <div className="account-actions" style={{ marginTop: "var(--sp-4)" }}>
              <button
                type="button"
                className="btn-primary"
                onClick={handleSaveOthers}
                disabled={othersSaving}
              >
                {othersSaving ? t("actions.loading", { ns: "common" }) : t("actions.save", { ns: "common" })}
              </button>
            </div>
          </div>
        </AccordionSection>
      </div>
    </section>
  );
}

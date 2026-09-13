/**
 * Preferences — appearance, badges, and how much the page moves.
 *
 * ⚠ Nothing here has a save button, and that is not laziness: a theme, a language
 * and a font APPLY AS YOU PICK THEM. The page you are looking at is the preview, so
 * a "save" step would ask you to confirm a change you can already see, and a
 * "discard" would have to undo the site around you.
 *
 * ⚠ The theme swatches are drawn from the palette they represent, not from the
 * current one — "Dark" must look dark while you are in the light theme, which is
 * the only reason a literal colour appears in this file.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../../hooks/useTheme";
import { useFont, FONTS } from "../../../hooks/useFont";
import { toast } from "../../../lib/toast";
import { apiErrorMessage } from "../../../lib/swal";
import { useAuth, refreshCurrentUser } from "../../../hooks/useAuth";
import { api } from "../../../lib/api";
import i18n, { SUPPORTED_LOCALES, setLocale, type LocaleCode } from "../../../lib/i18n";
import { AccountCard, AccountRow, AccountSwitch } from "../components/AccountCard";
import { SavedChip } from "../components/SaveBar";

const THEMES = ["light", "dark", "system"] as const;

interface OtherToggles {
  reduceMotion:  boolean;
  compactView:   boolean;
  autoPlayMedia: boolean;
}

const OTHER_KEYS: (keyof OtherToggles)[] = ["reduceMotion", "compactView", "autoPlayMedia"];

interface BadgeItem {
  id: string;
  name: string;
  key: string;
  displayOrder: number;
  badgeLabel: string | null;
  badgeColor: string | null;
  visible: boolean;
}

/** Which of your group badges appear beside your name. */
function BadgeVisibility() {
  const { t } = useTranslation("account");
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
      await refreshCurrentUser();   // the nav and MeCard draw these too
    } catch (e) {
      setItems(items);              // revert
      toast.error(apiErrorMessage(e));
    } finally {
      setSavingId(null);
    }
  }

  if (items === null) return <p className="account-hint">{t("preferences.badgesLoading")}</p>;
  if (items.length === 0) return <p className="account-hint">{t("preferences.badgesNone")}</p>;

  const visible = items.filter((b) => b.visible).length;

  return (
    <>
      {items.map((b) => (
        <AccountRow
          key={b.id}
          label={b.badgeLabel ?? b.name}
          control={
            <AccountSwitch
              on={b.visible}
              disabled={savingId === b.id}
              label={b.badgeLabel ?? b.name}
              onToggle={() => void toggle(b)}
            />
          }
        />
      ))}
      {/* ⚠ Only when it MATTERS. Three is the cap, so the warning is worth the space
          exactly when someone has turned on a fourth. */}
      {visible > 3 && <p className="account-hint acct-hint--warn">{t("preferences.badgesOverCap")}</p>}
    </>
  );
}

const LS_OTHERS_KEY = "xt_pref_others";

function loadOthers(): OtherToggles {
  const fallback = { reduceMotion: false, compactView: false, autoPlayMedia: true };
  try {
    const raw = localStorage.getItem(LS_OTHERS_KEY);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch { return fallback; }
}

export function PreferencesTab() {
  const { t } = useTranslation("account");
  const { preference, setPreference } = useTheme();
  const { font, setFont } = useFont();
  const { user } = useAuth();
  const [locale, setLocaleState] = useState<string>(user?.preferredLocale ?? i18n.language ?? "en");
  const [localeSaving, setLocaleSaving] = useState(false);
  const [others, setOthers] = useState<OtherToggles>(loadOthers);

  async function chooseLocale(code: LocaleCode) {
    setLocaleState(code);
    setLocale(code);              // apply + cookie immediately
    setLocaleSaving(true);
    try {
      await api.patch("/account/profile", { preferredLocale: code });
      if (user) user.preferredLocale = code;
    } catch {
      toast.error(t("preferences.languageSaveError"));
    } finally {
      setLocaleSaving(false);
    }
  }

  /**
   * ⚠ Written on click, not behind a Save.
   *
   * These three live in `localStorage` only (there is no endpoint yet), so "saving"
   * them is a synchronous write to this browser — putting a button in front of it
   * bought nothing but a step to forget.
   */
  function flipOther(key: keyof OtherToggles) {
    setOthers((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(LS_OTHERS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }

  return (
    <>
      <AccountCard title={t("preferences.appearance")} desc={t("preferences.appearanceDesc")}>
        <div className="acct-stack">
          <div className="acct-group">
            <span className="acct-group__label">{t("preferences.theme")}</span>
            <div className="acct-themes">
              {THEMES.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`acct-pickcard${preference === value ? " is-on" : ""}`}
                  onClick={() => setPreference(value)}
                >
                  <span className={`acct-themeswatch acct-themeswatch--${value}`} />
                  {t(`preferences.themes.${value}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="acct-group">
            <span className="acct-group__label">{t("preferences.language")}</span>
            <div className="acct-chips">
              {SUPPORTED_LOCALES.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  className={`acct-chip${locale.startsWith(l.code) ? " is-on" : ""}`}
                  disabled={localeSaving}
                  onClick={() => void chooseLocale(l.code)}
                >
                  {l.native}
                </button>
              ))}
            </div>
          </div>

          <div className="acct-group">
            <span className="acct-group__label">{t("preferences.font")}</span>
            <div className="acct-fonts">
              <button
                type="button"
                className={`acct-pickcard acct-pickcard--text${font === "default" ? " is-on" : ""}`}
                onClick={() => setFont("default")}
              >
                <strong>{t("preferences.fontDefault")}</strong>
                <span>{t("preferences.fontDefaultDesc")}</span>
              </button>
              {FONTS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  className={`acct-pickcard acct-pickcard--text${font === f.value ? " is-on" : ""}`}
                  // The one place a font literal belongs: the button IS the sample.
                  style={{ fontFamily: f.stack }}
                  onClick={() => setFont(f.value)}
                >
                  <strong>{f.label}</strong>
                  <span>{f.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </AccountCard>

      <AccountCard title={t("preferences.badges")} desc={t("preferences.badgesDesc")}>
        <BadgeVisibility />
      </AccountCard>

      <AccountCard title={t("preferences.reading")} desc={t("preferences.readingDesc")}>
        {OTHER_KEYS.map((key) => (
          <AccountRow
            key={key}
            label={t(`preferences.${key}`)}
            desc={t(`preferences.${key}Desc`)}
            control={
              <AccountSwitch
                on={others[key]}
                label={t(`preferences.${key}`)}
                onToggle={() => flipOther(key)}
              />
            }
          />
        ))}
      </AccountCard>

      <SavedChip label={t("preferences.appliedNote")} />
    </>
  );
}

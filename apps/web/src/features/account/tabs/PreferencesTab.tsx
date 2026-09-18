/**
 * Preferences — appearance, badges, and how much the page moves.
 *
 * ⚠ Nothing here has a save button, and that is not laziness: a language and a font
 * APPLY AS YOU PICK THEM. The page you are looking at is the preview, so a "save" step
 * would ask you to confirm a change you can already see, and a "discard" would have to
 * undo the site around you.
 *
 * ⚠ The light/dark picker that used to sit here is gone. A site has ONE look — the
 * theme's — so a radio that set `data-theme` on a site with no dark palette was a
 * control that did nothing. What replaced it picks a THEME, which is the real choice,
 * and it is the same choice the footer chooser offers: one cookie, one vocabulary.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { setViewerTheme, viewerThemeId } from "../../../lib/viewerTheme";
import { useFont, FONTS } from "../../../hooks/useFont";
import { toast } from "../../../lib/toast";
import { apiErrorMessage } from "../../../lib/swal";
import { useAuth, refreshCurrentUser } from "../../../hooks/useAuth";
import { api } from "../../../lib/api";
import i18n, { SUPPORTED_LOCALES, setLocale, type LocaleCode } from "../../../lib/i18n";
import { AccountCard, AccountRow, AccountSwitch } from "../components/AccountCard";
import { SavedChip } from "../components/SaveBar";

/**
 * An installed theme a reader may choose to wear. `/themes/choices` is public and
 * deliberately narrow — a name, a picture and a sentence, never the vendor or who
 * installed it, which is an admin's inventory and none of a reader's business.
 */
interface ThemeChoice {
  id: string;
  name: string;
  active: boolean;
  description: string | null;
  screenshot: string | null;
}

/**
 * Pick which installed theme to read the site in — the same choice the footer offers.
 *
 * ⚠ Choosing RELOADS. The stylesheet and the layout documents change together, and
 * every open query, every mounted block and the SSE reconciler would otherwise have to
 * be talked through it — for something a reader does once. The footer chooser made the
 * same call; doing it differently here would be two behaviours for one decision.
 *
 * ⚠ Choosing the SITE's theme CLEARS the cookie rather than storing its id. Storing it
 * would pin the reader to today's active theme, and they would go on wearing it after
 * the admin switched — having chosen "the site's theme", which is then the one thing
 * that would not follow the site.
 */
function ThemeChoices() {
  const { t } = useTranslation("account");
  const { t: tc } = useTranslation("common");
  const [themes, setThemes] = useState<ThemeChoice[] | null>(null);
  const chosen = viewerThemeId();

  useEffect(() => {
    let alive = true;
    api.get<{ themes: ThemeChoice[] }>("/themes/choices")
      .then((r) => { if (alive) setThemes(r?.themes ?? []); })
      // A site that cannot answer simply has no picker. This is a preference, not
      // something worth an error message in a settings page.
      .catch(() => { if (alive) setThemes([]); });
    return () => { alive = false; };
  }, []);

  // Nothing to choose BETWEEN is not a choice: one installed theme means the site's
  // own, and a row with a single card in it is furniture. Same rule as the footer.
  if (!themes || themes.length < 2) return null;

  const siteTheme = themes.find((x) => x.active);
  /** What is being worn: the reader's pick, or the site's own when they have none. */
  const wearing = chosen ?? siteTheme?.id ?? "";

  return (
    <div className="acct-group">
      <span className="acct-group__label">{t("preferences.theme")}</span>
      <div className="acct-themes">
        {themes.map((theme) => {
          const worn = theme.id === wearing;
          return (
            <button
              key={theme.id}
              type="button"
              className={`acct-themecard${worn ? " is-on" : ""}`}
              aria-current={worn}
              onClick={() => {
                setViewerTheme(theme.active ? null : theme.id);
                window.location.reload();
              }}
            >
              <span className="acct-themecard__shot">
                {theme.screenshot
                  ? <img src={theme.screenshot} alt="" loading="lazy" />
                  : <span className="acct-themecard__noshot" aria-hidden="true">{theme.name.slice(0, 1)}</span>}
              </span>
              <span className="acct-themecard__name">
                {theme.name}
                {/* TWO different facts, and a reader can be looking at either. "Active"
                    is what THEY are wearing; "Site" is what the admin chose for
                    everyone. They coincide until the reader picks something else,
                    which is exactly when telling them apart starts to matter. */}
                {worn   && <span className="acct-themecard__badge is-on">{tc("themeChooser.activeBadge")}</span>}
                {theme.active && <span className="acct-themecard__badge">{tc("themeChooser.siteBadge")}</span>}
              </span>
              {/* Omitted rather than padded with the theme's own name back at the
                  reader: a theme with nothing to say about itself has the picture. */}
              {theme.description && (
                <span className="acct-themecard__desc">{theme.description}</span>
              )}
            </button>
          );
        })}
      </div>
      <p className="acct-group__note">{tc("themeChooser.note")}</p>
    </div>
  );
}

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
          <ThemeChoices />

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

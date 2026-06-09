import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../../lib/i18n";
import { getCookie, setCookie } from "../../lib/cookies";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheck,
  faXmark,
  faArrowsRotate,
  faArrowLeft,
  faArrowRight,
  faRocket,
  faPlug,
  faSun,
  faMoon,
  faComments,
  faMagnifyingGlass,
  faMobileScreen,
  faShieldHalved,
  faGlobe,
  faUser,
  faHouse,
  faCircleCheck,
  faTriangleExclamation,
  faLanguage,
} from "@fortawesome/free-solid-svg-icons";
import { installerApi } from "./installer.api.js";
import { useTheme } from "../../hooks/useTheme.js";
import "../../styles/installer.scss";

const STEPS_KEYS = ["welcome", "environment", "database", "site", "admin", "finalize", "done"];
const ENV_ROW_KEYS = ["node", "postgres", "redis", "storage", "database_url", "data_dir"];
const TOTAL = STEPS_KEYS.length;

// Common timezones list
const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Moscow",
  "Asia/Dubai",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

const STEP_INDEX: Record<string, number> = {
  WELCOME: 0, ENVIRONMENT: 1, DATABASE: 2,
  SITE_CONFIG: 3, ADMIN: 4, FINALIZE: 5, COMPLETE: 6,
};

export function InstallerWizard() {
  const { t } = useTranslation("installer");
  const { theme, toggle } = useTheme();
  const [step, setStep] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  // Restore step from server on mount — prevents resetting to step 1 on page refresh.
  // The mounted flag prevents React 18 StrictMode's double-invoke from calling setStep
  // on the stale (already-unmounted) first mount instance.
  useEffect(() => {
    let mounted = true;
    installerApi.status().then((s) => {
      if (!mounted) return;
      const idx = STEP_INDEX[s.currentStep] ?? 0;
      if (idx > 0 && idx < 6) setStep(idx);
    }).catch(() => {/* API not yet reachable — stay at 0 */});
    return () => { mounted = false; };
  }, []);

  const [envResult, setEnvResult] = useState<Record<
    string,
    { ok: boolean; detail: string }
  > | null>(null);
  const [revealed, setRevealed] = useState(0);
  const envPassed =
    !!envResult && revealed >= ENV_ROW_KEYS.length && ENV_ROW_KEYS.every((k) => envResult[k]?.ok);

  const [dbTesting, setDbTesting] = useState(false);
  const [dbResult, setDbResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const [site, setSite] = useState({
    siteName: "My Forum",
    siteUrl: "https://forum.example.com",
    locale: "en",
    timezone: "UTC",
  });
  const [admin, setAdmin] = useState({
    email: "",
    username: "admin",
    password: "",
    confirm: "",
  });

  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("Preparing");
  const [siteId, setSiteId] = useState<string | null>(null);

  // Language initialisation from cookie
  useEffect(() => {
    const savedLang = getCookie("nv_locale");
    const lang = savedLang && ["en", "es", "fr", "de", "pt"].includes(savedLang) ? savedLang : "en";
    i18n.changeLanguage(lang);
    setSite((prev) => ({ ...prev, locale: lang }));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const tId = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(tId);
  }, [toast]);

  async function runEnvCheck() {
    setEnvResult(null);
    setRevealed(0);
    try {
      const data = await installerApi.environment();
      const map: Record<string, { ok: boolean; detail: string }> = {};
      data.checks.forEach((c: any) => {
        map[c.key] = { ok: c.ok, detail: c.detail };
      });
      setEnvResult(map);
    } catch {
      const map: Record<string, { ok: boolean; detail: string }> = {};
      ENV_ROW_KEYS.forEach((k) => {
        map[k] = { ok: false, detail: "Could not reach the server" };
      });
      setEnvResult(map);
    }
  }

  useEffect(() => {
    if (step === 1 && envResult === null) void runEnvCheck();
  }, [step]);

  useEffect(() => {
    if (!envResult) return;
    setRevealed(0);
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setRevealed(i);
      if (i >= ENV_ROW_KEYS.length) clearInterval(id);
    }, 550);
    return () => clearInterval(id);
  }, [envResult]);

  async function testDb() {
    setDbTesting(true);
    setDbResult(null);
    try {
      await installerApi.testDatabase();
      setDbResult({ ok: true, msg: t("database.connected") });
    } catch (e: unknown) {
      setDbResult({
        ok: false,
        msg: e instanceof Error ? e.message : t("database.connection_failed"),
      });
    } finally {
      setDbTesting(false);
    }
  }

  function showToast(m: string) {
    setToast(m);
  }

  function validateAdmin() {
    if (!admin.email.includes("@")) return (showToast(t("toast.admin_invalid_email")), false);
    if (admin.username.trim().length < 3)
      return (showToast(t("toast.admin_invalid_username")), false);
    if (admin.password.length < 5) return (showToast(t("toast.admin_invalid_password")), false);
    if (admin.password !== admin.confirm)
      return (showToast(t("toast.admin_password_mismatch")), false);
    return true;
  }

  function handleLanguageChange(newLocale: string) {
    setSite((prev) => ({ ...prev, locale: newLocale }));
    i18n.changeLanguage(newLocale);
    setCookie("nv_locale", newLocale, 365);
  }

  function handleTimezoneChange(newTimezone: string) {
    setSite((prev) => ({ ...prev, timezone: newTimezone }));
  }

  function next() {
    if (step === 1 && !envPassed) return showToast(t("toast.env_fail"));
    if (step === 2 && !dbResult?.ok) return showToast(t("toast.db_fail"));
    if (step === 4 && !validateAdmin()) return;
    setStep((s) => Math.min(s + 1, TOTAL - 1));
  }

  function back() {
    if (!installing) setStep((s) => Math.max(s - 1, 0));
  }

  async function runInstall() {
    if (installing) return;
    setInstalling(true);
    setProgress(5);
    setProgressText(t("finalize.progress.migrations"));
    try {
      await installerApi.database();
      setProgress(40);
      setProgressText(t("finalize.progress.seeding"));
      setProgress(60);
      setProgressText(t("finalize.progress.site"));
      await installerApi.site({
        siteName: site.siteName,
        siteUrl: site.siteUrl,
        locale: site.locale,
        timezone: site.timezone, // <-- send timezone
      });
      setProgress(78);
      setProgressText(t("finalize.progress.admin"));
      await installerApi.admin({
        email: admin.email,
        username: admin.username,
        password: admin.password,
      });
      setProgress(92);
      setProgressText(t("finalize.progress.keys"));
      const res = (await installerApi.finalize()) as { siteId?: string };
      setSiteId(res.siteId ?? null);
      setProgress(100);
      setProgressText(t("finalize.progress.complete"));
      await new Promise((r) => setTimeout(r, 500));
      setStep(TOTAL - 1);
      spawnConfetti();
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : String(e);
      // Map internal server error codes to readable messages
      const friendly: Record<string, string> = {
        not_installed:    "Could not reach the API server. Make sure it is running.",
        install_disabled: "This instance is already installed.",
        already_installed:"This instance is already installed.",
      };
      showToast(friendly[raw] ?? raw ?? t("toast.install_failed"));
      setInstalling(false);
    }
  }

  const dotState = (idx: number) =>
    idx === 1 && envResult && !envPassed && step > 1
      ? "error-step"
      : idx < step
        ? "completed"
        : idx === step
          ? "active"
          : "";

  const envIcon = (cls: string) =>
    cls === "checking" ? faArrowsRotate : cls === "pass" ? faCheck : faXmark;

  const features = [
    {
      c: "purple",
      icon: faComments,
      titleKey: "welcome.features.discussions.title",
      descKey: "welcome.features.discussions.desc",
    },
    {
      c: "blue",
      icon: faMagnifyingGlass,
      titleKey: "welcome.features.search.title",
      descKey: "welcome.features.search.desc",
    },
    {
      c: "green",
      icon: faMobileScreen,
      titleKey: "welcome.features.responsive.title",
      descKey: "welcome.features.responsive.desc",
    },
    {
      c: "amber",
      icon: faShieldHalved,
      titleKey: "welcome.features.security.title",
      descKey: "welcome.features.security.desc",
    },
  ];

  return (
    <div className="nv-installer-page">
      <div className="wizard-container">
        <header className="wizard-header">
          <div className="wizard-logo">
            <div className="icon">
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.2}
              >
                <path d="M5 19V5l14 14V5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <span>Nodevo</span>
          </div>
          <div className="header-actions">
            <div className="language-switcher">
              <FontAwesomeIcon icon={faLanguage} />
              <select
                value={site.locale}
                onChange={(e) => handleLanguageChange(e.target.value)}
                aria-label={t("site.language")}
              >
                <option value="en">English</option>
                <option value="es">Español</option>
                <option value="fr">Français</option>
                <option value="de">Deutsch</option>
                <option value="pt">Português</option>
              </select>
            </div>
            <button className="theme-toggle" onClick={toggle} aria-label="Toggle theme">
              <FontAwesomeIcon icon={theme === "light" ? faMoon : faSun} />
              {theme === "light" ? "Dark" : "Light"}
            </button>
          </div>
        </header>

        <div className="step-indicator">
          {STEPS_KEYS.map((_, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center" }}>
              <span
                className={`step-dot ${dotState(i)}`}
                onClick={() => !installing && i <= step && setStep(i)}
              >
                {i < step ? <FontAwesomeIcon icon={faCheck} /> : i + 1}
              </span>
              {i < TOTAL - 1 && <span className={`step-line ${i < step ? "completed" : ""}`} />}
            </span>
          ))}
        </div>

        <div className="wizard-content">
          <div className="step-panel" key={step}>
            {renderPanel()}
          </div>
        </div>

        {step < TOTAL - 1 && (
          <footer className="wizard-footer">
            <button
              className="btn btn-back"
              onClick={back}
              style={{ visibility: step === 0 ? "hidden" : "visible" }}
            >
              <FontAwesomeIcon icon={faArrowLeft} /> {t("buttons.back")}
            </button>
            <div style={{ flex: 1 }} />
            {step === 5 ? (
              <button className="btn btn-install" onClick={runInstall} disabled={installing}>
                <FontAwesomeIcon icon={faRocket} />{" "}
                {installing ? t("buttons.installing") : t("buttons.install")}
              </button>
            ) : (
              <button
                className="btn btn-next"
                onClick={next}
                disabled={(step === 1 && !envPassed) || (step === 2 && !dbResult?.ok)}
              >
                {t("buttons.next")} <FontAwesomeIcon icon={faArrowRight} />
              </button>
            )}
          </footer>
        )}
      </div>
      {toast && (
        <div className="toast">
          <FontAwesomeIcon icon={faTriangleExclamation} /> {toast}
        </div>
      )}
    </div>
  );

  function renderPanel() {
    switch (step) {
      case 0:
        return (
          <>
            <h2 className="step-title">{t("welcome.title")}</h2>
            <p className="step-subtitle">{t("welcome.subtitle")}</p>
            <div className="welcome-features">
              {features.map((f) => (
                <div className="welcome-feature" key={f.titleKey}>
                  <div className={`feat-icon ${f.c}`}>
                    <FontAwesomeIcon icon={f.icon} />
                  </div>
                  <div>
                    <h4>{t(f.titleKey)}</h4>
                    <p>{t(f.descKey)}</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        );
      case 1:
        return (
          <>
            <h2 className="step-title">{t("environment.title")}</h2>
            <p className="step-subtitle">{t("environment.subtitle")}</p>
            <div className="env-list">
              {ENV_ROW_KEYS.map((key, i) => {
                const res = envResult && i < revealed ? envResult[key] : null;
                const cls = !res ? "checking" : res.ok ? "pass" : "fail";
                return (
                  <div className="env-item" key={key}>
                    <div className={`env-icon ${cls}`}>
                      <FontAwesomeIcon icon={envIcon(cls)} />
                    </div>
                    <div className="env-info">
                      <div className="env-name">{t(`environment.rows.${key}`)}</div>
                      <div className="env-detail">
                        {res ? res.detail : t("environment.status.checking")}
                      </div>
                    </div>
                    <span className={`env-status ${cls}`}>
                      {!res
                        ? t("environment.status.checking")
                        : res.ok
                          ? t("environment.status.passed")
                          : t("environment.status.failed")}
                    </span>
                  </div>
                );
              })}
            </div>
            {envResult && revealed >= ENV_ROW_KEYS.length && !envPassed && (
              <div style={{ marginTop: 14, textAlign: "center" }}>
                <button className="btn btn-retry" onClick={runEnvCheck}>
                  <FontAwesomeIcon icon={faArrowsRotate} /> {t("environment.retry")}
                </button>
              </div>
            )}
          </>
        );
      case 2: {
        const cls = dbTesting ? "checking" : dbResult ? (dbResult.ok ? "pass" : "fail") : "";
        return (
          <>
            <h2 className="step-title">{t("database.title")}</h2>
            <p
              className="step-subtitle"
              dangerouslySetInnerHTML={{ __html: t("database.subtitle") }}
            />
            <div className="env-list">
              <div className="env-item">
                <div className={`env-icon ${cls || "checking"}`}>
                  <FontAwesomeIcon
                    icon={
                      dbTesting
                        ? faArrowsRotate
                        : dbResult?.ok
                          ? faCheck
                          : dbResult
                            ? faXmark
                            : faPlug
                    }
                  />
                </div>
                <div className="env-info">
                  <div className="env-name">{t("database.postgres")}</div>
                  <div className="env-detail">{dbResult?.msg ?? t("database.not_tested")}</div>
                </div>
              </div>
            </div>
            <button
              className="btn btn-soft"
              style={{ marginTop: 14 }}
              onClick={testDb}
              disabled={dbTesting}
            >
              <FontAwesomeIcon icon={faPlug} />{" "}
              {dbTesting ? t("database.testing") : t("database.test_button")}
            </button>
          </>
        );
      }
      case 3:
        return (
          <>
            <h2 className="step-title">{t("site.title")}</h2>
            <p className="step-subtitle">{t("site.subtitle")}</p>
            <div className="form-group">
              <label>
                {t("site.site_name")} <span className="required">*</span>
              </label>
              <input
                value={site.siteName}
                onChange={(e) => setSite({ ...site, siteName: e.target.value })}
                placeholder={t("site.site_name")}
              />
            </div>
            <div className="form-group">
              <label>
                {t("site.site_url")} <span className="required">*</span>
              </label>
              <input
                value={site.siteUrl}
                onChange={(e) => setSite({ ...site, siteUrl: e.target.value })}
                placeholder="https://forum.example.com"
              />
              <span className="hint">{t("site.url_hint")}</span>
            </div>
            <div className="form-group">
              <label>{t("site.language")}</label>
              <select value={site.locale} onChange={(e) => handleLanguageChange(e.target.value)}>
                <option value="en">English (US)</option>
                <option value="es">Spanish</option>
                <option value="fr">French</option>
                <option value="de">German</option>
                <option value="pt">Portuguese</option>
              </select>
            </div>
            <div className="form-group">
              <label>{t("site.timezone")}</label>
              <select value={site.timezone} onChange={(e) => handleTimezoneChange(e.target.value)}>
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
              <span className="hint">{t("site.timezone_hint")}</span>
            </div>
          </>
        );
      case 4: {
        const p = admin.password;
        const strong = p.length >= 5 && /[0-9]/.test(p) && /[^a-zA-Z0-9]/.test(p);
        return (
          <>
            <h2 className="step-title">{t("admin.title")}</h2>
            <p className="step-subtitle">{t("admin.subtitle")}</p>
            <div className="form-group">
              <label>
                {t("admin.email")} <span className="required">*</span>
              </label>
              <input
                type="email"
                value={admin.email}
                onChange={(e) => setAdmin({ ...admin, email: e.target.value })}
                placeholder="admin@example.com"
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>
                  {t("admin.username")} <span className="required">*</span>
                </label>
                <input
                  value={admin.username}
                  onChange={(e) => setAdmin({ ...admin, username: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>
                  {t("admin.password")} <span className="required">*</span>
                </label>
                <input
                  type="password"
                  value={admin.password}
                  onChange={(e) => setAdmin({ ...admin, password: e.target.value })}
                  placeholder={t("admin.password_hint")}
                />
                <span
                  className="hint"
                  style={{
                    color: !p
                      ? undefined
                      : p.length < 5 || !strong
                        ? "var(--warning)"
                        : "var(--success)",
                  }}
                >
                  {!p ? (
                    t("admin.password_hint")
                  ) : p.length < 5 ? (
                    <>
                      <FontAwesomeIcon icon={faTriangleExclamation} />{" "}
                      {t("admin.password_too_short", { length: p.length })}
                    </>
                  ) : strong ? (
                    <>
                      <FontAwesomeIcon icon={faCheck} /> {t("admin.password_strong")}
                    </>
                  ) : (
                    <>
                      <FontAwesomeIcon icon={faTriangleExclamation} /> {t("admin.password_weak")}
                    </>
                  )}
                </span>
              </div>
            </div>
            <div className="form-group">
              <label>
                {t("admin.confirm")} <span className="required">*</span>
              </label>
              <input
                type="password"
                value={admin.confirm}
                onChange={(e) => setAdmin({ ...admin, confirm: e.target.value })}
                placeholder={t("admin.confirm")}
              />
              {admin.confirm && (
                <span
                  className="hint"
                  style={{
                    color: admin.password === admin.confirm ? "var(--success)" : "var(--error)",
                  }}
                >
                  {admin.password === admin.confirm ? (
                    <>
                      <FontAwesomeIcon icon={faCheck} /> {t("admin.match")}
                    </>
                  ) : (
                    <>
                      <FontAwesomeIcon icon={faXmark} /> {t("admin.mismatch")}
                    </>
                  )}
                </span>
              )}
            </div>
          </>
        );
      }
      case 5:
        return (
          <>
            <h2 className="step-title">{t("finalize.title")}</h2>
            <p className="step-subtitle">{t("finalize.subtitle")}</p>
            <div className="summary-section">
              <h4>
                <FontAwesomeIcon icon={faGlobe} /> {t("finalize.site_section")}
              </h4>
              <div className="summary-row">
                <span className="key">{t("site.site_name")}</span>
                <span className="val">{site.siteName}</span>
              </div>
              <div className="summary-row">
                <span className="key">{t("site.site_url")}</span>
                <span className="val">{site.siteUrl}</span>
              </div>
              <div className="summary-row">
                <span className="key">{t("site.language")}</span>
                <span className="val">{site.locale.toUpperCase()}</span>
              </div>
              <div className="summary-row">
                <span className="key">{t("site.timezone")}</span>
                <span className="val">{site.timezone}</span>
              </div>
            </div>
            <div className="summary-section">
              <h4>
                <FontAwesomeIcon icon={faUser} /> {t("finalize.admin_section")}
              </h4>
              <div className="summary-row">
                <span className="key">{t("admin.email")}</span>
                <span className="val">{admin.email || "-"}</span>
              </div>
              <div className="summary-row">
                <span className="key">{t("admin.username")}</span>
                <span className="val">{admin.username}</span>
              </div>
            </div>
            {installing && (
              <div className="install-progress">
                <div className="progress-bar-track">
                  <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
                </div>
                <div className="progress-text">{progressText}</div>
              </div>
            )}
          </>
        );
      default:
        return (
          <>
            <div className="done-icon">
              <FontAwesomeIcon icon={faCircleCheck} />
            </div>
            <h2 className="step-title" style={{ textAlign: "center" }}>
              {t("done.title")}
            </h2>
            <p className="step-subtitle" style={{ textAlign: "center" }}>
              {t("done.subtitle")}
            </p>
            {siteId && (
              <p style={{ textAlign: "center", fontSize: 12, color: "var(--text-muted)" }}>
                Site ID: <code>{siteId}</code>
              </p>
            )}
            <div className="done-links">
              <a
                className="done-link primary-link"
                onClick={() => (window.location.href = "/")}
              >
                <FontAwesomeIcon icon={faHouse} /> {t("done.goto")}
              </a>
            </div>
          </>
        );
    }
  }
}

function spawnConfetti() {
  const colors = ["#7c6af7", "#a78bfa", "#34d399", "#fbbf24", "#f87171", "#38bdf8", "#ec4899"];
  for (let i = 0; i < 80; i++) {
    const p = document.createElement("div");
    p.className = "confetti-piece";
    p.style.left = Math.random() * 100 + "%";
    p.style.top = -(Math.random() * 80 + 10) + "px";
    p.style.width = Math.random() * 8 + 4 + "px";
    p.style.height = Math.random() * 14 + 6 + "px";
    p.style.background = colors[Math.floor(Math.random() * colors.length)]!;
    p.style.borderRadius = Math.random() > 0.5 ? "50%" : "2px";
    p.style.animationDuration = Math.random() * 2 + 2.5 + "s";
    p.style.animationDelay = Math.random() * 1.2 + "s";
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 4000);
  }
}

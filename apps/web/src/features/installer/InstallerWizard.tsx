import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../../lib/i18n";
import { getCookie, setCookie } from "../../lib/cookies";
import { FontAwesomeIcon } from "../../components/Icon";
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
  faAngleUp,
  faAngleDown
} from "@fortawesome/free-solid-svg-icons";
import { installerApi } from "./installer.api.js";
import { useTheme } from "../../hooks/useTheme.js";
import "../../styles/installer.scss";

const STEPS_KEYS = ["welcome", "environment", "database", "site", "admin", "finalize", "done"];
const TOTAL = STEPS_KEYS.length;

type EnvCheck = { key: string; name: string; ok: boolean; detail: string };

// How long the wizard waits for the setup-mode hot swap (POST /install/setup
// → .env written → setup server closes → full app boots on the same port).
const SWAP_TIMEOUT_MS = 30_000;
const SWAP_POLL_MS = 1_000;

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

// Advisory password-strength rules for the admin step meter. These drive the
// meter/checklist UI only — the install gate validation stays in validateAdmin().
const PW_RULES: { id: string; test: (v: string) => boolean }[] = [
  { id: "length", test: (v) => v.length >= 12 },
  { id: "upper",  test: (v) => /[A-Z]/.test(v) },
  { id: "lower",  test: (v) => /[a-z]/.test(v) },
  { id: "number", test: (v) => /[0-9]/.test(v) },
  { id: "symbol", test: (v) => /[^A-Za-z0-9]/.test(v) },
];

function passwordStrength(pw: string) {
  const passed = PW_RULES.filter((r) => r.test(pw)).length;
  const level =
    pw.length === 0 ? "empty" : passed <= 1 ? "weak" : passed <= 3 ? "fair" : passed === 4 ? "good" : "strong";
  const color =
    passed <= 1 ? "var(--error)" : passed <= 3 ? "var(--warning)" : passed === 4 ? "var(--accent)" : "var(--success)";
  return { passed, level, color };
}

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
      setSetupMode(!!s.setupMode);
      const idx = STEP_INDEX[s.currentStep] ?? 0;
      if (idx > 0 && idx < 6) setStep(idx);
    }).catch(() => {/* API not yet reachable — stay at 0 */});
    return () => { mounted = false; };
  }, []);

  // Setup mode: no usable .env yet — the API is the minimal setup server and
  // the step collects credentials instead of testing a preconfigured
  // connection.
  const [setupMode, setSetupMode] = useState(false);

  const [envChecks, setEnvChecks] = useState<EnvCheck[] | null>(null);
  const [revealed, setRevealed] = useState(0);
  const envPassed =
    !!envChecks && revealed >= envChecks.length && envChecks.every((c) => c.ok);

  const [dbTesting, setDbTesting] = useState(false);
  const [dbSwapping, setDbSwapping] = useState(false);
  const [dbResult, setDbResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [dbForm, setDbForm] = useState({
    host: "localhost",
    port: "5432",
    database: "",
    user: "",
    password: "",
    redisUrl: "",
  });
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [site, setSite] = useState({
    siteName: "Nodevo",
    siteUrl: "https://localhost",
    locale: "en",
    timezone: "UTC",
  });
  const [admin, setAdmin] = useState({
    email: "",
    username: "",
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
    setEnvChecks(null);
    setRevealed(0);
    try {
      // The server decides which rows apply: full 6 checks normally, lite
      // checks (node / .env writable / data dir) in setup mode.
      const data = await installerApi.environment();
      setEnvChecks(data.checks);
    } catch {
      setEnvChecks([
        { key: "server", name: "API server", ok: false, detail: "Could not reach the server" },
      ]);
    }
  }

  useEffect(() => {
    if (step === 1 && envChecks === null) void runEnvCheck();
  }, [step]);

  useEffect(() => {
    if (!envChecks) return;
    setRevealed(0);
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setRevealed(i);
      if (i >= envChecks.length) clearInterval(id);
    }, 550);
    return () => clearInterval(id);
  }, [envChecks]);

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

  /** Setup mode: post credentials, then poll until the hot-swapped full API
   *  answers the status probe without the setupMode flag. */
  async function connectAndSave() {
    setDbTesting(true);
    setDbResult(null);
    try {
      await installerApi.setup({
        host: dbForm.host.trim(),
        port: Number(dbForm.port) || 5432,
        database: dbForm.database.trim(),
        user: dbForm.user.trim(),
        password: dbForm.password,
        redisUrl: dbForm.redisUrl.trim() || undefined,
      });

      setDbSwapping(true);
      const deadline = Date.now() + SWAP_TIMEOUT_MS;
      let swapped = false;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, SWAP_POLL_MS));
        try {
          const s = await installerApi.status();
          if (!s.setupMode) { swapped = true; break; }
        } catch { /* listener is mid-swap — keep polling */ }
      }
      if (!swapped) throw new Error(t("database.setup_failed"));

      setSetupMode(false);
      setDbResult({ ok: true, msg: t("database.connected") });
      setStep(STEP_INDEX.SITE_CONFIG!);
    } catch (e: unknown) {
      setDbResult({
        ok: false,
        msg: e instanceof Error ? e.message : t("database.connection_failed"),
      });
    } finally {
      setDbTesting(false);
      setDbSwapping(false);
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
    idx === 1 && envChecks && !envPassed && step > 1
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
            </button>
          </div>
        </header>

        <div className="wiz-progress">
          <div className="wiz-progress__inner">
            <div className="wiz-progress__line-base" />
            <div className="wiz-progress__line-fill" style={{ width: `${(step / TOTAL) * 100}%` }} />
            <div className="wiz-progress__row">
              {STEPS_KEYS.map((key, i) => {
                const state = dotState(i);
                const status = state === "error-step" ? "error" : i < step ? "done" : i === step ? "active" : "todo";
                const clickable = !installing && i <= step;
                return (
                  <div
                    key={key}
                    className={`circ-item ${status === "active" ? "is-active" : ""}`}
                    style={{ cursor: clickable ? "pointer" : "default" }}
                    onClick={() => clickable && setStep(i)}
                  >
                    <div className={`circ ${status}`}>
                      {status === "done" ? <FontAwesomeIcon icon={faCheck} /> : i + 1}
                    </div>
                    <span className="circ-label">{t(`steps.${key}`)}</span>
                  </div>
                );
              })}
            </div>
          </div>
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
              {(envChecks ?? [{ key: "loading", name: "", ok: false, detail: "" }]).map(
                (check, i) => {
                  const res = envChecks && i < revealed ? check : null;
                  const cls = !res ? "checking" : res.ok ? "pass" : "fail";
                  return (
                    <div className="env-item" key={check.key}>
                      <div className={`env-icon ${cls}`}>
                        <FontAwesomeIcon icon={envIcon(cls)} />
                      </div>
                      <div className="env-info">
                        <div className="env-name">
                          {envChecks
                            ? t(`environment.rows.${check.key}`, { defaultValue: check.name })
                            : t("environment.status.checking")}
                        </div>
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
                },
              )}
            </div>
            {envChecks && revealed >= envChecks.length && !envPassed && (
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

        if (setupMode) {
          // No .env yet — collect credentials; the server verifies them,
          // writes the config (secrets included) and hot-swaps to full mode.
          return (
            <>
              <h2 className="step-title">{t("database.title")}</h2>
              <p className="step-subtitle">{t("database.setup_subtitle")}</p>
              <div className="form-row">
                <div className="form-group">
                  <label>
                    {t("database.host")} <span className="required">*</span>
                  </label>
                  <input
                    value={dbForm.host}
                    onChange={(e) => setDbForm({ ...dbForm, host: e.target.value })}
                    placeholder="localhost"
                    disabled={dbTesting}
                  />
                </div>
                <div className="form-group">
                  <label>{t("database.port")}</label>
                  <input
                    value={dbForm.port}
                    onChange={(e) => setDbForm({ ...dbForm, port: e.target.value })}
                    placeholder="5432"
                    disabled={dbTesting}
                  />
                </div>
              </div>
              <div className="form-group">
                <label>
                  {t("database.db_name")} <span className="required">*</span>
                </label>
                <input
                  value={dbForm.database}
                  onChange={(e) => setDbForm({ ...dbForm, database: e.target.value })}
                  placeholder="nodevo"
                  disabled={dbTesting}
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>
                    {t("database.user")} <span className="required">*</span>
                  </label>
                  <input
                    value={dbForm.user}
                    onChange={(e) => setDbForm({ ...dbForm, user: e.target.value })}
                    disabled={dbTesting}
                  />
                </div>
                <div className="form-group">
                  <label>{t("database.password")}</label>
                  <input
                    type="password"
                    value={dbForm.password}
                    onChange={(e) => setDbForm({ ...dbForm, password: e.target.value })}
                    disabled={dbTesting}
                  />
                </div>
              </div>
              <button
                type="button"
                className="btn btn-soft"
                style={{ marginBottom: 10 }}
                onClick={() => setShowAdvanced((v) => !v)}
              >
                {t("database.advanced")} {showAdvanced ? (<FontAwesomeIcon icon={faAngleDown} />) : (<FontAwesomeIcon icon={faAngleUp} />)}
              </button>
              {showAdvanced && (
                <div className="form-group">
                  <label>{t("database.redis_url")}</label>
                  <input
                    value={dbForm.redisUrl}
                    onChange={(e) => setDbForm({ ...dbForm, redisUrl: e.target.value })}
                    placeholder="redis://localhost:6379"
                    disabled={dbTesting}
                  />
                  <span className="hint">{t("database.redis_hint")}</span>
                </div>
              )}
              <button
                className="btn btn-next"
                style={{ marginTop: 8 }}
                onClick={connectAndSave}
                disabled={dbTesting || !dbForm.host.trim() || !dbForm.database.trim() || !dbForm.user.trim()}
              >
                <FontAwesomeIcon icon={dbTesting ? faArrowsRotate : faPlug} />{" "}
                {dbSwapping
                  ? t("database.swap_wait")
                  : dbTesting
                    ? t("database.connecting")
                    : t("database.connect")}
              </button>
              {dbResult && (
                <p
                  className="hint"
                  style={{
                    marginTop: 10,
                    color: dbResult.ok ? "var(--success)" : "var(--error)",
                  }}
                >
                  <FontAwesomeIcon icon={dbResult.ok ? faCheck : faXmark} /> {dbResult.msg}
                </p>
              )}
            </>
          );
        }

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
        const pw = passwordStrength(p);
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
                  placeholder={"Administrator"}
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
            {/* Password strength meter + rule checklist (advisory) */}
            <div className="pw-box">
              <div className="pw-meter">
                <div className="pw-track">
                  <div
                    className="pw-fill"
                    style={{
                      width: `${(pw.passed / PW_RULES.length) * 100}%`,
                      background: pw.color,
                    }}
                  />
                </div>
                <span
                  className="pw-label"
                  style={{ color: p.length === 0 ? "var(--text-muted)" : pw.color }}
                >
                  {t(`admin.pw_strength.${pw.level}`)}
                </span>
              </div>
              <div className="pw-grid">
                {PW_RULES.map((r) => {
                  const ok = r.test(p);
                  return (
                    <div className={`pw-item ${ok ? "ok" : ""}`} key={r.id}>
                      <span className="pw-ic">
                        <FontAwesomeIcon icon={ok ? faCheck : faXmark} />
                      </span>
                      <span className="pw-text">{t(`admin.pw_rules.${r.id}`)}</span>
                    </div>
                  );
                })}
              </div>
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
                onClick={() => (window.location.href = "/admin")}
              >
                <FontAwesomeIcon icon={faHouse} /> {t("done.goto")}
              </a>
            </div>
          </>
        );
    }
  }
}
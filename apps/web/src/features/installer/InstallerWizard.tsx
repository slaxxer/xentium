import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../../lib/i18n";
import { getCookie, setCookie } from "../../lib/cookies";
import { FontAwesomeIcon } from "../../components/Icon";
import {
  faCheck,
  faXmark,
  faMinus,
  faArrowsRotate,
  faArrowLeft,
  faArrowRight,
  faRocket,
  faKeyboard,
  faDatabase,
  faFileCode,
  faReceipt,
  faStore,
  faLink,
  faCopy,
  faBoxOpen,
  faLock,
  faPlus,
  faPuzzlePiece,
  faDice,
  faEye,
  faEyeSlash,
  faChevronUp,
  faChevronDown,
  faCircleInfo,
  faCircleCheck,
  faTriangleExclamation,
  faWandMagicSparkles,
  faRotateLeft,
  faShieldHalved,
  faPlugCircleBolt,
  faGlobe,
  faUserShield,
  faSliders,
  faHouse,
  faClock,
  faLanguage,
} from "@fortawesome/free-solid-svg-icons";
import { INSTALL_TWO_FACTOR_GROUPS, type MarketplaceListing } from "@xentium/contracts";
import { installerApi, setInstallToken, type LinkStart } from "./installer.api.js";
import "../../styles/installer.scss";
import { XentiumMark } from "../../components/XentiumMark";

// ─────────────────────────────────────────────────────────────────────────────
// The wizard's eight steps, grouped into three phases for the rail. The order
// mirrors the server's InstallStep machine exactly — the rail is a view of it,
// not a second opinion.
// ─────────────────────────────────────────────────────────────────────────────
const S = {
  WELCOME: 0,
  ENVIRONMENT: 1,
  DATABASE: 2,
  SITE: 3,
  ADDONS: 4,
  ADMIN: 5,
  FINALIZE: 6,
  DONE: 7,
} as const;

const STEPS = [
  { key: "welcome",     phase: "prepare"   },
  { key: "environment", phase: "prepare"   },
  { key: "database",    phase: "configure" },
  { key: "site",        phase: "configure" },
  { key: "addons",      phase: "configure" },
  { key: "admin",       phase: "finish"    },
  { key: "finalize",    phase: "finish"    },
  { key: "done",        phase: "finish"    },
] as const;

const PHASES = ["prepare", "configure", "finish"] as const;
const TOTAL = STEPS.length;

/** Where the server's step name lands in the rail. */
const STEP_INDEX: Record<string, number> = {
  WELCOME: S.WELCOME, ENVIRONMENT: S.ENVIRONMENT, DATABASE: S.DATABASE,
  SITE_CONFIG: S.SITE, ADDONS: S.ADDONS, ADMIN: S.ADMIN,
  FINALIZE: S.FINALIZE, COMPLETE: S.DONE,
};

type EnvCheck = { key: string; name: string; ok: boolean; detail: string; warn?: boolean };

// How long the wizard waits for the setup-mode hot swap (POST /install/setup
// → .env written → setup server closes → full app boots on the same port).
const SWAP_TIMEOUT_MS = 30_000;
const SWAP_POLL_MS = 1_000;

/** Debounce on the setup-mode credential probe — long enough that typing a
 *  hostname is one round trip, not one per keystroke. */
const PROBE_DEBOUNCE_MS = 700;

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

// Advisory password-strength rules for the admin step meter. These drive the
// meter/checklist UI only — the install gate stays in validateAdmin().
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
    pw.length === 0 ? "var(--text-muted)"
    : passed <= 1 ? "var(--error)"
    : passed <= 3 ? "var(--warning)"
    : passed === 4 ? "var(--accent)"
    : "var(--success)";
  return { passed, level, color };
}

/** Words + digits + a symbol: long, typeable, and it passes every rule above. */
function generatePassphrase(): string {
  const words = ["harbor", "lantern", "cobalt", "meadow", "quartz", "ember", "willow", "signal", "beacon", "thistle"];
  const rand = (n: number) => {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0]! % n;
  };
  const pick = () => words[rand(words.length)]!;
  const head = pick();
  return `${head.charAt(0).toUpperCase()}${head.slice(1)}-${pick()}-${pick()}-${10 + rand(89)}!`;
}

/** The languages the wizard ships. Bundled locales only — §60 is LTR/5 in v1. */
const INSTALLER_LOCALES = ["en", "es", "fr", "de", "pt"];

type DbState = "idle" | "testing" | "ok" | "fail" | "preparing";
type LogLine = { time: string; text: string; tone?: "ok" | "fail" };

export function InstallerWizard() {
  const { t } = useTranslation("installer");
  const [step, setStep] = useState<number>(S.WELCOME);
  const [toast, setToast] = useState<{ msg: string; tone: "ok" | "warn" } | null>(null);
  const [version, setVersion] = useState<string | null>(null);

  // Setup mode: no usable .env yet — the API is the minimal setup server and
  // the DATABASE step collects credentials instead of testing a preconfigured
  // connection.
  const [setupMode, setSetupMode] = useState(false);

  // Restore step from the server on mount — prevents resetting to step 1 on a
  // page refresh. The mounted flag prevents React StrictMode's double-invoke
  // from calling setStep on the stale first mount instance.
  useEffect(() => {
    let mounted = true;
    installerApi.status().then((s) => {
      if (!mounted) return;
      setSetupMode(!!s.setupMode);
      setVersion(s.version ?? null);
      const idx = STEP_INDEX[s.currentStep] ?? 0;
      if (idx > 0 && idx < S.DONE) setStep(idx);
    }).catch(() => {/* API not yet reachable — stay at 0 */});
    return () => { mounted = false; };
  }, []);

  // ── Step 1: environment ────────────────────────────────────────────────────
  const [envChecks, setEnvChecks] = useState<EnvCheck[] | null>(null);
  const [revealed, setRevealed] = useState(0);
  const envDone = !!envChecks && revealed >= envChecks.length;
  const envPassed = envDone && envChecks!.every((c) => c.ok);

  // ── Step 2: database ───────────────────────────────────────────────────────
  const [dbState, setDbState] = useState<DbState>("idle");
  const [dbDetail, setDbDetail] = useState<string | null>(null);
  const [dbSwapping, setDbSwapping] = useState(false);
  const [dbPrepared, setDbPrepared] = useState(false);
  const [dbForm, setDbForm] = useState({
    host: "localhost",
    port: "5432",
    database: "",
    user: "",
    password: "",
    redisUrl: "",
  });
  const [envPreviewOpen, setEnvPreviewOpen] = useState(false);
  const [secretsRevealed, setSecretsRevealed] = useState(false);
  const probeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Only the newest probe may write the strip: a slow answer for credentials
  // that have since been retyped would otherwise overwrite a newer result.
  const probeSeq = useRef(0);

  // ── Step 3: site ───────────────────────────────────────────────────────────
  const [site, setSite] = useState({
    siteName: "Xentium",
    siteUrl: "https://localhost",
    locale: "en",
    timezone: "UTC",
  });

  // ── Step 4: add-ons ────────────────────────────────────────────────────────
  const [addonsLoading, setAddonsLoading] = useState(false);
  const [addons, setAddons] = useState<{
    reachable: boolean; connected: boolean; accountRef: string | null;
    listings: MarketplaceListing[]; ownedIds: string[];
  } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [link, setLink] = useState<LinkStart | null>(null);
  const [linkSkipped, setLinkSkipped] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  // ── Step 5: admin ──────────────────────────────────────────────────────────
  const [admin, setAdmin] = useState({ email: "", username: "", password: "", confirm: "" });
  // Who must use two-factor sign-in. Administrators are ticked to start with.
  const [tfaGroups, setTfaGroups] = useState<(typeof INSTALL_TWO_FACTOR_GROUPS)[number][]>(["admin"]);
  const [pwVisible, setPwVisible] = useState(false);

  // ── Step 6/7: install + done ───────────────────────────────────────────────
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [duration, setDuration] = useState<string | null>(null);
  const [installedAddons, setInstalledAddons] = useState<string[]>([]);
  const [recapOpen, setRecapOpen] = useState(false);
  const [recapCopied, setRecapCopied] = useState(false);

  // The language the wizard speaks, and the one the site is created with.
  //
  // These have to be the SAME value. i18n already resolves the browser's
  // language when there is no cookie, so forcing "en" here left an installer
  // reading in French creating a site whose default language is English —
  // visible only after the install, in the admin panel.
  useEffect(() => {
    const saved = getCookie("xt_locale");
    const detected = i18n.resolvedLanguage ?? i18n.language;
    const lang = INSTALLER_LOCALES.includes(saved ?? "") ? saved!
      : INSTALLER_LOCALES.includes(detected) ? detected
      : "en";
    void i18n.changeLanguage(lang);
    setSite((prev) => ({ ...prev, locale: lang }));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(id);
  }, [toast]);

  function showToast(msg: string, tone: "ok" | "warn" = "warn") {
    setToast({ msg, tone });
  }

  // ── Environment ────────────────────────────────────────────────────────────
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
        { key: "server", name: "API server", ok: false, detail: t("environment.unreachable") },
      ]);
    }
  }

  useEffect(() => {
    if (step === S.ENVIRONMENT && envChecks === null) void runEnvCheck();
  }, [step]);

  useEffect(() => {
    if (!envChecks) return;
    setRevealed(0);
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setRevealed(i);
      if (i >= envChecks.length) clearInterval(id);
    }, 260);
    return () => clearInterval(id);
  }, [envChecks]);

  /** The node version, for the rail footer. Real data, already fetched. */
  const nodeVersion = envChecks?.find((c) => c.key === "node")?.detail.match(/v?\d+\.\d+\.\d+/)?.[0] ?? null;

  // ── Database ───────────────────────────────────────────────────────────────
  const dbComplete = !!(dbForm.host.trim() && dbForm.database.trim() && dbForm.user.trim());

  /** Non-setup mode: the server already holds DATABASE_URL, so there is nothing
   *  to type and the step simply reports whether it works. */
  async function testDb() {
    setDbState("testing");
    setDbDetail(null);
    try {
      await installerApi.testDatabase();
      setDbState("ok");
      // The strip's title already says "Connected"; the detail names WHICH
      // database, which is the part an operator with several of them needs.
      // The environment step already asked the server and got it redacted.
      setDbDetail(envChecks?.find((c) => c.key === "database_url")?.detail ?? null);
    } catch (e: unknown) {
      setDbState("fail");
      setDbDetail(e instanceof Error ? e.message : t("database.connection_failed"));
    }
  }

  useEffect(() => {
    if (step === S.DATABASE && !setupMode && dbState === "idle") void testDb();
  }, [step, setupMode]);

  /** Setup mode: every edit re-arms a debounced probe that verifies the
   *  credentials WITHOUT writing anything. */
  function editDb(patch: Partial<typeof dbForm>) {
    const next = { ...dbForm, ...patch };
    setDbForm(next);
    if (probeTimer.current) clearTimeout(probeTimer.current);

    if (!(next.host.trim() && next.database.trim() && next.user.trim())) {
      setDbState("idle");
      setDbDetail(null);
      return;
    }

    setDbState("testing");
    setDbDetail(null);
    const seq = ++probeSeq.current;
    probeTimer.current = setTimeout(async () => {
      try {
        const r = await installerApi.probe({
          host: next.host.trim(),
          port: Number(next.port) || 5432,
          database: next.database.trim(),
          user: next.user.trim(),
          password: next.password,
          redisUrl: next.redisUrl.trim() || undefined,
        });
        if (seq !== probeSeq.current) return;
        setDbState("ok");
        setDbDetail(
          [
            r.postgres ? `PostgreSQL ${r.postgres}` : t("database.postgres"),
            `${r.latencyMs} ms`,
            r.redis ? `Redis ${r.redis}` : null,
          ].filter(Boolean).join(" · "),
        );
      } catch (e: unknown) {
        if (seq !== probeSeq.current) return;
        setDbState("fail");
        setDbDetail(e instanceof Error ? e.message : t("database.connection_failed"));
      }
    }, PROBE_DEBOUNCE_MS);
  }

  useEffect(() => () => { if (probeTimer.current) clearTimeout(probeTimer.current); }, []);

  /** Setup mode: post credentials, then poll until the hot-swapped full API
   *  answers the status probe without the setupMode flag. */
  async function connectAndSave(): Promise<boolean> {
    setDbState("preparing");
    setDbDetail(t("database.swap_wait"));
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
          if (!s.setupMode) { swapped = true; setVersion(s.version ?? null); break; }
        } catch { /* listener is mid-swap — keep polling */ }
      }
      if (!swapped) throw new Error(t("database.setup_failed"));

      setSetupMode(false);
      return true;
    } catch (e: unknown) {
      setDbState("fail");
      setDbDetail(e instanceof Error ? e.message : t("database.connection_failed"));
      return false;
    } finally {
      setDbSwapping(false);
    }
  }

  /**
   * Create the schema and seed core groups + permissions.
   *
   * This runs when you leave the DATABASE step rather than during the final
   * install, because the two steps AFTER it need a database: the add-ons step
   * reads this install's identity (minted with the install row) to talk to the
   * marketplace at all. "Connect your database" ends with a database that is
   * actually ready, which is also what the step says it does.
   */
  async function prepareDatabase(): Promise<boolean> {
    if (dbPrepared) return true;
    setDbState("preparing");
    setDbDetail(t("database.preparing"));
    try {
      await installerApi.database();
      setDbPrepared(true);
      setDbState("ok");
      setDbDetail(t("database.prepared"));
      return true;
    } catch (e: unknown) {
      setDbState("fail");
      setDbDetail(e instanceof Error ? e.message : t("database.connection_failed"));
      return false;
    }
  }

  /** The `.env` the server will write. The four secrets are generated ON THE
   *  SERVER and never travel to the browser, so they are shown as placeholders
   *  — the panel is about what lands in the file, not about their values. */
  const envFileText = (() => {
    const pw = dbForm.password ? (secretsRevealed ? dbForm.password : "••••") : "";
    const auth = pw ? `${dbForm.user || "user"}:${pw}` : (dbForm.user || "user");
    const url = `postgresql://${auth}@${dbForm.host || "host"}:${dbForm.port || "5432"}/${dbForm.database || "database"}`;
    const generated = `<${t("database.env_generated")}>`;
    return [
      `DATABASE_URL="${url}"`,
      `REDIS_URL="${dbForm.redisUrl || "redis://localhost:6379"}"`,
      `APP_URL="${site.siteUrl}"`,
      `COOKIE_SECRET="${generated}"`,
      `JWT_SECRET="${generated}"`,
      `REFRESH_TOKEN_HMAC_SECRET="${generated}"`,
      `DUMMY_ARGON2_HASH="${generated}"`,
    ].join("\n");
  })();

  // ── Add-ons ────────────────────────────────────────────────────────────────
  async function loadAddons() {
    setAddonsLoading(true);
    try {
      const data = await installerApi.addons();
      setAddons(data);
      setPicked((prev) => (prev.length ? prev : data.selected));
    } catch {
      setAddons({ reachable: false, connected: false, accountRef: null, listings: [], ownedIds: [] });
    } finally {
      setAddonsLoading(false);
    }
  }

  useEffect(() => {
    if (step === S.ADDONS && addons === null && !addonsLoading) void loadAddons();
  }, [step]);

  async function startLink() {
    try {
      const started = await installerApi.startLink();
      setLink(started);
      setLinkSkipped(false);
      setCodeCopied(false);
      // Opened from the click's own handler chain so it is not treated as a
      // popup. If the browser blocks it anyway, the URL is on screen.
      window.open(started.approveUrl, "_blank", "noopener,noreferrer");
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : t("addons.link_failed"));
    }
  }

  // Poll the handshake on the cadence the marketplace named.
  useEffect(() => {
    if (!link) return;
    let cancelled = false;
    const id = setInterval(async () => {
      try {
        const r = await installerApi.pollLink(link.linkId);
        if (cancelled || r.status === "pending") return;
        clearInterval(id);
        setLink(null);
        if (r.status === "approved") {
          showToast(t("addons.linked"), "ok");
          await loadAddons();
        } else {
          showToast(t(r.status === "denied" ? "addons.link_denied" : "addons.link_expired"));
        }
      } catch (e: unknown) {
        if (cancelled) return;
        // A poll is a question about someone else's decision — a failed one
        // means the handshake is dead, not that it should be retried forever.
        clearInterval(id);
        setLink(null);
        showToast(e instanceof Error ? e.message : t("addons.link_failed"));
      }
    }, Math.max(link.pollInterval, 2) * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [link?.linkId]);

  async function unlinkAccount() {
    try {
      await installerApi.unlink();
      // The download gate is authenticated for every product, so unlinking
      // does not just lock the paid ones — nothing can be fetched at all.
      setPicked([]);
      await loadAddons();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : t("addons.link_failed"));
    }
  }

  /**
   * Why a card cannot be picked, or null when it can.
   *
   * ⚠ "Free" does not mean "no account needed". The marketplace's download gate
   * is authenticated for EVERY product (ADR-0001: the authenticated download is
   * the chokepoint), so without a linked account a free plugin is as
   * un-downloadable as a paid one. Offering it and failing during the install
   * run is the version of this that looks like a bug.
   */
  function addonLock(l: MarketplaceListing): "account" | "licence" | "unreleased" | null {
    if (!l.latestVersion) return "unreleased";
    if (!addons?.connected) return "account";
    if (!l.licenseRequired && l.priceCents === 0) return null;
    return addons.ownedIds.includes(l.id) || l.owned ? null : "licence";
  }

  function toggleAddon(l: MarketplaceListing) {
    if (addonLock(l)) return;
    setPicked((prev) => (prev.includes(l.id) ? prev.filter((x) => x !== l.id) : [...prev, l.id]));
  }

  const pickedListings = (addons?.listings ?? []).filter((l) => picked.includes(l.id));

  // ── Navigation ─────────────────────────────────────────────────────────────
  function validateAdmin() {
    if (!admin.email.includes("@")) return (showToast(t("toast.admin_invalid_email")), false);
    if (!/^[a-zA-Z0-9_]{3,32}$/.test(admin.username.trim()))
      return (showToast(t("toast.admin_invalid_username")), false);
    if (admin.password.length < 12) return (showToast(t("toast.admin_invalid_password")), false);
    if (admin.password !== admin.confirm)
      return (showToast(t("toast.admin_password_mismatch")), false);
    return true;
  }

  // Leaving a step can mean doing work, so Continue is async and the button
  // says so while it runs.
  const [advancing, setAdvancing] = useState(false);

  async function next() {
    if (advancing) return;
    const go = (i: number) => setStep(Math.min(i, TOTAL - 1));

    if (step === S.ENVIRONMENT && !envPassed) return showToast(t("toast.env_fail"));

    if (step === S.DATABASE) {
      if (setupMode) {
        if (dbState !== "ok") return showToast(t("toast.db_fail"));
        setAdvancing(true);
        try {
          if (!(await connectAndSave())) return;
          if (!(await prepareDatabase())) return;
        } finally { setAdvancing(false); }
        return go(S.SITE);
      }
      if (dbState !== "ok") return showToast(t("toast.db_fail"));
      setAdvancing(true);
      try { if (!(await prepareDatabase())) return; } finally { setAdvancing(false); }
      return go(S.SITE);
    }

    if (step === S.SITE) {
      if (!site.siteName.trim()) return showToast(t("toast.site_name_required"));
      setAdvancing(true);
      try {
        await installerApi.site({ ...site, siteName: site.siteName.trim(), siteUrl: site.siteUrl.trim() });
      } catch (e: unknown) {
        return showToast(e instanceof Error ? e.message : t("toast.site_failed"));
      } finally { setAdvancing(false); }
      return go(S.ADDONS);
    }

    if (step === S.ADDONS) {
      setAdvancing(true);
      try {
        await installerApi.selectAddons(picked);
      } catch (e: unknown) {
        return showToast(e instanceof Error ? e.message : t("addons.select_failed"));
      } finally { setAdvancing(false); }
      return go(S.ADMIN);
    }

    if (step === S.ADMIN && !validateAdmin()) return;

    go(step + 1);
  }

  function back() {
    if (!installing && !advancing) setStep((s) => Math.max(s - 1, 0));
  }

  // ── The install run ────────────────────────────────────────────────────────
  const startedAt = useRef(0);

  function log(text: string, tone?: "ok" | "fail") {
    const secs = ((Date.now() - startedAt.current) / 1000).toFixed(1).padStart(4, "0");
    setLogLines((prev) => [...prev, { time: `+${secs}s`, text, tone }]);
  }

  async function runInstall() {
    if (installing) return;
    setInstalling(true);
    setLogLines([]);
    setProgress(0);
    startedAt.current = Date.now();

    try {
      setProgressText(t("finalize.progress.admin"));
      setProgress(12);
      const { accessToken } = await installerApi.admin({
        email: admin.email.trim(),
        username: admin.username.trim(),
        password: admin.password,
        twoFactorGroups: tfaGroups,
      });
      // The one authenticated installer route is the add-on download below.
      setInstallToken(accessToken);
      log(t("finalize.log.admin", { username: admin.username.trim() }));

      const done: string[] = [];
      if (pickedListings.length > 0) {
        setProgressText(t("finalize.progress.addons"));
        for (const [i, l] of pickedListings.entries()) {
          setProgress(20 + Math.round(((i + 1) / (pickedListings.length + 1)) * 60));
          try {
            const r = await installerApi.installAddon(l.id, l.latestVersion!);
            done.push(r.name);
            log(
              r.enabled
                ? t("finalize.log.addon", { name: r.name, version: r.version })
                : t("finalize.log.addon_installed_only", { name: r.name, version: r.version }),
              "ok",
            );
          } catch (e: unknown) {
            // One add-on failing is not an install failing. The site is fine
            // without it and the ACP can retry; saying so beats rolling back a
            // schema over a download.
            log(t("finalize.log.addon_failed", {
              name: l.name,
              reason: e instanceof Error ? e.message : "unknown",
            }), "fail");
          }
        }
      }
      setInstalledAddons(done);

      setProgressText(t("finalize.progress.keys"));
      setProgress(88);
      const res = await installerApi.finalize();
      setSiteId(res.siteId ?? null);
      log(t("finalize.log.finalized"));

      setProgress(100);
      setProgressText(t("finalize.progress.complete"));
      setDuration(`${((Date.now() - startedAt.current) / 1000).toFixed(1)}s`);
      log(t("finalize.log.complete"), "ok");
      await new Promise((r) => setTimeout(r, 600));
      setStep(S.DONE);
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : String(e);
      const friendly: Record<string, string> = {
        not_installed:     t("toast.api_unreachable"),
        install_disabled:  t("toast.already_installed"),
        already_installed: t("toast.already_installed"),
      };
      const msg = friendly[raw] ?? raw ?? t("toast.install_failed");
      log(msg, "fail");
      showToast(msg);
      setInstalling(false);
    }
  }

  function recapText(): string {
    const pad = (s: string) => s.padEnd(15, " ");
    return [
      `Xentium — ${site.siteName}`,
      ``,
      `${pad("Site URL")}${site.siteUrl}`,
      `${pad("Language")}${site.locale.toUpperCase()}`,
      `${pad("Timezone")}${site.timezone}`,
      `${pad("Administrator")}${admin.username} <${admin.email}>`,
      `${pad("Add-ons")}${installedAddons.length ? installedAddons.join(", ") : "none"}`,
      `${pad("Marketplace")}${addons?.connected ? addons.accountRef ?? "linked" : "not linked"}`,
      `${pad("Site ID")}${siteId ?? "—"}`,
      `${pad("Version")}${version ?? "—"}`,
      `${pad("Duration")}${duration ?? "—"}`,
    ].join("\n");
  }

  function copy(text: string, mark: (v: boolean) => void) {
    void navigator.clipboard?.writeText(text).catch(() => {});
    mark(true);
    setTimeout(() => mark(false), 1800);
  }

  function handleLanguageChange(locale: string) {
    setSite((prev) => ({ ...prev, locale }));
    void i18n.changeLanguage(locale);
    setCookie("xt_locale", locale, 365);
  }

  // ───────────────────────────────────────────────────────────────────────────
  const pct = Math.round((step / (TOTAL - 1)) * 100);
  const blocked =
    (step === S.ENVIRONMENT && !envPassed) ||
    (step === S.DATABASE && dbState !== "ok");
  const blockReason =
    step === S.DATABASE && dbState !== "ok" ? t("database.block_reason")
    : step === S.ENVIRONMENT && envDone && !envPassed ? t("environment.block_reason")
    : "";

  return (
    <div className="xt-installer-page">
      <aside className="inst-rail">
        <div className="inst-brand">
          <XentiumMark size={36} title="Xentium" brand />
          <div>
            <div className="name">Xentium</div>
            <div className="sub">{t("rail.setup")}</div>
          </div>
        </div>

        <div className="inst-meter">
          <div className="inst-meter__head">
            <span className="label">{t("rail.step_counter", { current: step + 1, total: TOTAL })}</span>
            <span className="pct">{pct}%</span>
          </div>
          <div className="inst-meter__segs">
            {STEPS.map((s, i) => (
              <span key={s.key} className={i < step ? "is-done" : i === step ? "is-active" : ""} />
            ))}
          </div>
        </div>

        <div className="inst-phases">
          {PHASES.map((phase) => {
            const entries = STEPS.map((s, i) => ({ ...s, i })).filter((s) => s.phase === phase);
            const allDone = entries.every((e) => e.i < step);
            const current = entries.some((e) => e.i === step);
            return (
              <div key={phase} className={`inst-phase${current ? " is-current" : allDone ? " is-done" : ""}`}>
                <div className="inst-phase__head">
                  <span className="name">{t(`phases.${phase}`)}</span>
                  <span className="rule" />
                  {allDone && <FontAwesomeIcon className="tick" icon={faCheck} />}
                </div>
                <div className="inst-phase__steps">
                  {entries.map((e) => {
                    const status = e.i < step ? "is-done" : e.i === step ? "is-active" : "";
                    // Only backwards, and never mid-install: jumping forward
                    // would skip work the next step depends on.
                    const clickable = e.i < step && !installing && !advancing;
                    return (
                      <button
                        key={e.key}
                        type="button"
                        className={`inst-step ${status}`}
                        disabled={!clickable}
                        onClick={() => clickable && setStep(e.i)}
                      >
                        <span className="dot">
                          {e.i < step ? <FontAwesomeIcon icon={faCheck} /> : e.i + 1}
                        </span>
                        <span className="label">{t(`steps.${e.key}`)}</span>
                        {e.i === step && t(`estimates.${e.key}`) && (
                          <span className="meta">{t(`estimates.${e.key}`)}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="inst-rail__foot">
          <div className="rule" />
          <div className="inst-lang">
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
          <div className="inst-help">{t("rail.help")}</div>
          <div className="inst-version">
            {version && <span>v{version}</span>}
            {version && nodeVersion && <span style={{ opacity: 0.5 }}>·</span>}
            {nodeVersion && <span>node {nodeVersion.replace(/^v/, "")}</span>}
          </div>
        </div>
      </aside>

      <main className="inst-main">
        <div className="inst-scroll">
          <div className="inst-panel">
            <div className="inst-eyebrow">
              <span className="step">{t("rail.step_counter", { current: step + 1, total: TOTAL })}</span>
              {t(`estimates.${STEPS[step]!.key}`) && (
                <span className="estimate">
                  <FontAwesomeIcon icon={faClock} /> {t(`estimates.${STEPS[step]!.key}`)}
                </span>
              )}
            </div>
            <div className="inst-screen" key={step}>{renderStep()}</div>
          </div>
        </div>

        {step < S.DONE && (
          <div className="inst-nav">
            <div className="inst-nav__inner">
              <button
                type="button"
                className="btn is-ghost"
                onClick={back}
                style={{ visibility: step === 0 ? "hidden" : "visible" }}
                disabled={installing || advancing}
              >
                <FontAwesomeIcon icon={faArrowLeft} /> {t("buttons.back")}
              </button>
              {blockReason && <span className="inst-nav__reason">{blockReason}</span>}
              <span className="spacer" />
              {step === S.FINALIZE ? (
                <button type="button" className="btn is-install" onClick={runInstall} disabled={installing}>
                  <FontAwesomeIcon icon={faRocket} />{" "}
                  {installing ? t("buttons.installing") : t("buttons.install")}
                </button>
              ) : (
                <button
                  type="button"
                  className={`btn is-primary${advancing ? " is-busy" : ""}`}
                  onClick={next}
                  disabled={blocked || advancing}
                >
                  {advancing && <FontAwesomeIcon icon={faArrowsRotate} />}
                  {step === 0 ? t("buttons.start") : t("buttons.next")}
                  {!advancing && <FontAwesomeIcon icon={faArrowRight} />}
                </button>
              )}
            </div>
          </div>
        )}
      </main>

      {toast && (
        <div className={`inst-toast${toast.tone === "ok" ? " is-ok" : ""}`}>
          <FontAwesomeIcon icon={toast.tone === "ok" ? faCircleCheck : faTriangleExclamation} />
          {toast.msg}
        </div>
      )}
    </div>
  );

  // ───────────────────────────────────────────────────────────────────────────
  function renderStep() {
    switch (step) {
      case S.WELCOME: return renderWelcome();
      case S.ENVIRONMENT: return renderEnvironment();
      case S.DATABASE: return renderDatabase();
      case S.SITE: return renderSite();
      case S.ADDONS: return renderAddons();
      case S.ADMIN: return renderAdmin();
      case S.FINALIZE: return renderFinalize();
      default: return renderDone();
    }
  }

  function renderWelcome() {
    const features = [
      { key: "noconfig", icon: faWandMagicSparkles, tone: "" },
      { key: "retry",    icon: faRotateLeft,        tone: "is-cyan" },
      { key: "locks",    icon: faShieldHalved,      tone: "is-success" },
      { key: "norestart",icon: faPlugCircleBolt,    tone: "is-warn" },
    ];
    return (
      <>
        <h1 className="inst-title">{t("welcome.title")}</h1>
        <p className="inst-lede">{t("welcome.subtitle", { count: TOTAL })}</p>
        <div className="inst-cards">
          {features.map((f) => (
            <div className="inst-card" key={f.key}>
              <div className={`ic ${f.tone}`}><FontAwesomeIcon icon={f.icon} /></div>
              <div>
                <h4>{t(`welcome.features.${f.key}.title`)}</h4>
                <p>{t(`welcome.features.${f.key}.desc`)}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="inst-note">
          <FontAwesomeIcon icon={faCircleInfo} />
          <div>{t("welcome.docker_hint")}</div>
        </div>
      </>
    );
  }

  function renderEnvironment() {
    const rows = envChecks ?? [];
    const summaryClass = !envDone ? "" : envPassed ? " is-pass" : " is-fail";
    return (
      <>
        <h1 className="inst-title">{t("environment.title")}</h1>
        <p className="inst-lede">{t("environment.subtitle")}</p>

        <div className={`inst-summary${summaryClass}`}>
          <div className={`inst-dot${!envDone ? " is-busy" : envPassed ? " is-pass" : " is-fail"}`}>
            <FontAwesomeIcon icon={!envDone ? faArrowsRotate : envPassed ? faCheck : faTriangleExclamation} />
          </div>
          <div className="txt">
            <div className="t">
              {!envDone ? t("environment.summary.running")
                : envPassed ? t("environment.summary.passed")
                : t("environment.summary.failed")}
            </div>
            <div className="s">
              {!envDone
                ? t("environment.summary.progress", { done: revealed, total: rows.length || 0 })
                : envPassed ? t("environment.summary.ready") : t("environment.summary.fix")}
            </div>
          </div>
          <button type="button" className="btn is-ghost is-sm" onClick={runEnvCheck}>
            <FontAwesomeIcon icon={faArrowsRotate} /> {t("environment.retry")}
          </button>
        </div>

        <div className="inst-box">
          {(rows.length ? rows : [{ key: "loading", name: "", ok: false, detail: "" }]).map((check, i) => {
            const res = envChecks && i < revealed ? check : null;
            // A warning passes — it never blocks Continue; it only looks different.
            const cls = !res ? "is-busy" : !res.ok ? "is-fail" : res.warn ? "is-warn" : "is-pass";
            return (
              <div className="inst-check" key={check.key}>
                <div className={`inst-dot ${cls}`}>
                  <FontAwesomeIcon
                    icon={!res ? faArrowsRotate : !res.ok ? faXmark : res.warn ? faTriangleExclamation : faCheck}
                  />
                </div>
                <div className="name">
                  {envChecks
                    ? t(`environment.rows.${check.key}`, { defaultValue: check.name })
                    : t("environment.status.checking")}
                </div>
                <div className="detail">{res ? res.detail : t("environment.status.checking")}</div>
              </div>
            );
          })}
        </div>
      </>
    );
  }

  function renderDatabase() {
    const stripClass =
      dbState === "ok" ? "is-pass"
      : dbState === "fail" ? "is-fail"
      : dbState === "testing" || dbState === "preparing" ? "is-busy"
      : "";
    const stripIcon =
      dbState === "ok" ? faCheck
      : dbState === "fail" ? faXmark
      : dbState === "testing" || dbState === "preparing" ? faArrowsRotate
      : faKeyboard;
    const stripTitle =
      dbState === "ok" ? t("database.connected")
      : dbState === "fail" ? t("database.connection_failed")
      : dbState === "preparing" ? t("database.preparing")
      : dbState === "testing" ? t("database.testing")
      : t("database.awaiting");

    if (!setupMode) {
      // The server already holds DATABASE_URL; there is nothing to type.
      return (
        <>
          <h1 className="inst-title">{t("database.title")}</h1>
          <p className="inst-lede">{t("database.configured_subtitle")}</p>
          <div className="inst-box">
            <div className="inst-strip" style={{ borderTop: "none" }}>
              <div className={`inst-dot ${stripClass}${dbState === "testing" || dbState === "preparing" ? " is-busy" : ""}`}>
                <FontAwesomeIcon icon={stripIcon} />
              </div>
              <div className="t">{stripTitle}</div>
              <div className="d">{dbDetail ?? t("database.not_tested")}</div>
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <button type="button" className="btn is-pill" onClick={testDb} disabled={dbState === "testing" || dbState === "preparing"}>
              <FontAwesomeIcon icon={faDatabase} /> {t("database.test_button")}
            </button>
          </div>
        </>
      );
    }

    const busy = dbSwapping || advancing;
    return (
      <>
        <h1 className="inst-title">{t("database.title")}</h1>
        <p className="inst-lede">{t("database.setup_subtitle")}</p>

        <div className="inst-box" style={{ marginBottom: 14 }}>
          <div className="inst-box__head">
            <span className="t"><FontAwesomeIcon icon={faDatabase} /> PostgreSQL</span>
            <button
              type="button"
              className="btn is-pill is-sm"
              disabled={busy}
              onClick={() => editDb({
                host: "localhost", port: "5432", database: "xentium",
                user: "xentium", password: "xentium", redisUrl: "redis://localhost:6379",
              })}
            >
              <FontAwesomeIcon icon={faPlugCircleBolt} /> {t("database.use_docker_defaults")}
            </button>
          </div>
          <div className="inst-box__body">
            <div className="inst-grid is-tight">
              <div className="inst-field">
                <label>{t("database.host")} <span className="req">*</span></label>
                <input value={dbForm.host} onChange={(e) => editDb({ host: e.target.value })} placeholder="localhost" disabled={busy} />
              </div>
              <div className="inst-field">
                <label>{t("database.port")}</label>
                <input value={dbForm.port} onChange={(e) => editDb({ port: e.target.value })} placeholder="5432" disabled={busy} />
              </div>
              <div className="inst-field">
                <label>{t("database.db_name")} <span className="req">*</span></label>
                <input value={dbForm.database} onChange={(e) => editDb({ database: e.target.value })} placeholder="xentium" disabled={busy} />
              </div>
              <div className="inst-field">
                <label>{t("database.user")} <span className="req">*</span></label>
                <input value={dbForm.user} onChange={(e) => editDb({ user: e.target.value })} disabled={busy} />
              </div>
              <div className="inst-field">
                <label>{t("database.password")}</label>
                <input type="password" value={dbForm.password} onChange={(e) => editDb({ password: e.target.value })} disabled={busy} />
              </div>
              <div className="inst-field">
                <label>{t("database.redis_url")}</label>
                <input value={dbForm.redisUrl} onChange={(e) => editDb({ redisUrl: e.target.value })} placeholder="redis://localhost:6379" disabled={busy} />
              </div>
            </div>
          </div>
          <div className={`inst-strip ${stripClass}`}>
            <div className={`inst-dot${dbState === "testing" || dbState === "preparing" ? " is-busy" : ""}`}>
              <FontAwesomeIcon icon={stripIcon} />
            </div>
            <div className="t">{stripTitle}</div>
            <div className="d">{dbDetail ?? (dbComplete ? "" : t("database.awaiting_detail"))}</div>
          </div>
        </div>

        <div className="inst-box">
          <button type="button" className="inst-disclose" onClick={() => setEnvPreviewOpen((v) => !v)}>
            <FontAwesomeIcon className="lead" icon={faFileCode} />
            <span className="txt">
              <span className="t">{t("database.env_preview_title")}</span>
              <span className="s">{t("database.env_preview_sub")}</span>
            </span>
            <FontAwesomeIcon className="chev" icon={envPreviewOpen ? faChevronUp : faChevronDown} />
          </button>
          {envPreviewOpen && (
            <div className="inst-code">
              <div className="inst-code__head">
                <span>.env · mode 0600</span>
                {dbForm.password && (
                  <button type="button" className="btn is-oncode" onClick={() => setSecretsRevealed((v) => !v)}>
                    <FontAwesomeIcon icon={secretsRevealed ? faEyeSlash : faEye} />
                    {secretsRevealed ? t("database.hide_password") : t("database.show_password")}
                  </button>
                )}
              </div>
              <pre>{envFileText}</pre>
            </div>
          )}
        </div>
      </>
    );
  }

  function renderSite() {
    return (
      <>
        <h1 className="inst-title">{t("site.title")}</h1>
        <p className="inst-lede">{t("site.subtitle")}</p>
        <div className="inst-grid">
          <div className="inst-field">
            <label>{t("site.site_name")} <span className="req">*</span></label>
            <input value={site.siteName} onChange={(e) => setSite({ ...site, siteName: e.target.value })} placeholder="Xentium" />
          </div>
          <div className="inst-field">
            <label>{t("site.site_url")} <span className="req">*</span></label>
            <input value={site.siteUrl} onChange={(e) => setSite({ ...site, siteUrl: e.target.value })} placeholder="https://forum.example.com" />
            <span className="hint">{t("site.url_hint")}</span>
          </div>
          <div className="inst-field">
            <label>{t("site.language")}</label>
            <select value={site.locale} onChange={(e) => handleLanguageChange(e.target.value)}>
              <option value="en">English (US)</option>
              <option value="es">Español</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
              <option value="pt">Português</option>
            </select>
          </div>
          <div className="inst-field">
            <label>{t("site.timezone")}</label>
            <select value={site.timezone} onChange={(e) => setSite({ ...site, timezone: e.target.value })}>
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
            <span className="hint">{t("site.timezone_hint")}</span>
          </div>
        </div>
      </>
    );
  }

  function renderAddons() {
    const connected = !!addons?.connected;
    return (
      <>
        <h1 className="inst-title">{t("addons.title")}</h1>
        <p className="inst-lede">{t("addons.subtitle")}</p>

        <div className={`inst-account${connected ? " is-linked" : ""}`}>
          {link ? (
            <div style={{ padding: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <div className="ic"><FontAwesomeIcon icon={faArrowsRotate} spin /></div>
                <div className="txt">
                  <div className="t">{t("addons.link_pending")}</div>
                  <div className="s">{t("addons.link_pending_sub")}</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div className="inst-code-chunks">
                  {link.userCode.split("-").map((chunk, i) => <span key={i}>{chunk}</span>)}
                </div>
                <button type="button" className="btn is-pill is-sm" onClick={() => copy(link.userCode, setCodeCopied)}>
                  <FontAwesomeIcon icon={codeCopied ? faCircleCheck : faCopy} />
                  {codeCopied ? t("addons.copied") : t("addons.copy_code")}
                </button>
                <button type="button" className="btn is-quiet is-sm" onClick={() => setLink(null)}>
                  {t("addons.cancel")}
                </button>
              </div>
            </div>
          ) : connected ? (
            <div className="inst-account__state">
              <div className="ic"><FontAwesomeIcon icon={faCircleCheck} /></div>
              <div className="txt">
                <div className="t">{t("addons.linked_title")}</div>
                <div className="s">
                  {addons!.accountRef ?? t("addons.linked_generic")}
                  {addons!.ownedIds.length > 0 && ` · ${t("addons.licences", { count: addons!.ownedIds.length })}`}
                </div>
              </div>
              <button type="button" className="btn is-ghost is-sm" onClick={unlinkAccount}>{t("addons.unlink")}</button>
            </div>
          ) : linkSkipped ? (
            <div className="inst-account__state">
              <FontAwesomeIcon icon={faCircleInfo} style={{ color: "var(--text-muted)" }} />
              <div className="txt"><div className="s">{t("addons.skipped")}</div></div>
              <button type="button" className="btn is-ghost is-sm" onClick={startLink}>{t("addons.link_now")}</button>
            </div>
          ) : (
            <div className="inst-account__state">
              <div className="ic"><FontAwesomeIcon icon={faStore} /></div>
              <div className="txt">
                <div className="t">{t("addons.account_title")}</div>
                <div className="s">{t("addons.account_sub")}</div>
              </div>
              <div className="acts">
                <button type="button" className="btn is-primary is-sm" onClick={startLink}>
                  <FontAwesomeIcon icon={faLink} /> {t("addons.link")}
                </button>
                <button type="button" className="btn is-ghost is-sm" onClick={() => setLinkSkipped(true)}>
                  {t("addons.not_now")}
                </button>
              </div>
            </div>
          )}
        </div>

        {addonsLoading ? (
          <div className="inst-tally">
            <FontAwesomeIcon icon={faArrowsRotate} spin /> <span>{t("addons.loading")}</span>
          </div>
        ) : !addons?.listings.length ? (
          <div className="inst-note">
            <FontAwesomeIcon icon={faCircleInfo} />
            <div>{t("addons.unreachable")}</div>
          </div>
        ) : (
          <>
            <div className="inst-addons">
              {addons.listings.map((l) => {
                const lock = addonLock(l);
                const on = picked.includes(l.id);
                const free = !l.licenseRequired && l.priceCents === 0;
                const owned = !free && !!(addons.ownedIds.includes(l.id) || l.owned);
                return (
                  <button
                    key={l.id}
                    type="button"
                    className={`inst-addon${on ? " is-on" : ""}${lock ? " is-locked" : ""}`}
                    disabled={!!lock}
                    onClick={() => toggleAddon(l)}
                  >
                    <span className="inst-addon__head">
                      <span className="ic"><FontAwesomeIcon icon={lock ? faLock : faPuzzlePiece} /></span>
                      <span className="txt">
                        <span className="name">{l.name}</span>
                        <span className="desc">
                          {lock === "account" ? t("addons.locked_account")
                            : lock === "licence" ? t("addons.locked_licence")
                            : lock === "unreleased" ? t("addons.locked_unreleased")
                            : l.description}
                        </span>
                      </span>
                      {on && <FontAwesomeIcon className="tick" icon={faCircleCheck} />}
                    </span>
                    <span className="inst-addon__foot">
                      <span className={`tag${owned ? " is-owned" : free ? "" : " is-paid"}`}>
                        {free ? t("addons.tag_free") : owned ? t("addons.tag_owned") : t("addons.tag_paid")}
                      </span>
                      <span className="ver">{l.latestVersion ?? t("addons.no_release")}</span>
                      <span className="cta">
                        <FontAwesomeIcon icon={lock ? faLock : on ? faCheck : faPlus} />{" "}
                        {lock === "account" ? t("addons.cta_link")
                          : lock === "licence" ? t("addons.cta_locked")
                          : lock === "unreleased" ? t("addons.no_release")
                          : on ? t("addons.cta_added") : t("addons.cta_add")}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="inst-tally">
              <FontAwesomeIcon icon={faBoxOpen} />
              <span>
                {picked.length ? t("addons.tally", { count: picked.length })
                  : connected ? t("addons.tally_empty")
                  : t("addons.tally_unlinked")}
              </span>
            </div>
          </>
        )}
      </>
    );
  }

  function renderAdmin() {
    const pw = passwordStrength(admin.password);
    const matches = admin.password === admin.confirm;
    return (
      <>
        <h1 className="inst-title">{t("admin.title")}</h1>
        <p className="inst-lede">{t("admin.subtitle")}</p>

        <div className="inst-grid" style={{ marginBottom: 16 }}>
          <div className="inst-field">
            <label>{t("admin.email")} <span className="req">*</span></label>
            <input
              type="email"
              value={admin.email}
              onChange={(e) => setAdmin({ ...admin, email: e.target.value })}
              placeholder="you@example.com"
            />
          </div>
          <div className="inst-field">
            <label>{t("admin.username")} <span className="req">*</span></label>
            <input
              value={admin.username}
              onChange={(e) => setAdmin({ ...admin, username: e.target.value })}
              placeholder={t("admin.username_placeholder")}
            />
            <span className="hint">{t("admin.username_hint")}</span>
          </div>
        </div>

        <div className="inst-box">
          <div className="inst-box__body">
            <div className="inst-grid">
              <div className="inst-field">
                <label>
                  <span>{t("admin.password")} <span className="req">*</span></span>
                  <button
                    type="button"
                    className="btn is-pill is-sm"
                    style={{ padding: "3px 9px", fontSize: "var(--fs-2xs)" }}
                    onClick={() => {
                      const generated = generatePassphrase();
                      setAdmin((a) => ({ ...a, password: generated, confirm: generated }));
                      setPwVisible(true);
                      showToast(t("admin.generated"), "ok");
                    }}
                  >
                    <FontAwesomeIcon icon={faDice} /> {t("admin.generate")}
                  </button>
                </label>
                <div className="with-action">
                  <input
                    type={pwVisible ? "text" : "password"}
                    value={admin.password}
                    onChange={(e) => setAdmin({ ...admin, password: e.target.value })}
                    placeholder={t("admin.password_hint")}
                  />
                  <button
                    type="button"
                    className="reveal"
                    aria-label={pwVisible ? t("admin.hide_password") : t("admin.show_password")}
                    onClick={() => setPwVisible((v) => !v)}
                  >
                    <FontAwesomeIcon icon={pwVisible ? faEyeSlash : faEye} />
                  </button>
                </div>
              </div>
              <div className={`inst-field${!admin.confirm ? "" : matches ? " is-ok" : " is-bad"}`}>
                <label><span>{t("admin.confirm")} <span className="req">*</span></span></label>
                <input
                  type={pwVisible ? "text" : "password"}
                  value={admin.confirm}
                  onChange={(e) => setAdmin({ ...admin, confirm: e.target.value })}
                  placeholder={t("admin.confirm_placeholder")}
                />
                {admin.confirm && (
                  <span className={`hint ${matches ? "is-ok" : "is-bad"}`}>
                    <FontAwesomeIcon icon={matches ? faCheck : faXmark} />{" "}
                    {matches ? t("admin.match") : t("admin.mismatch")}
                  </span>
                )}
              </div>
            </div>

            <div className="inst-pw__segs">
              {PW_RULES.map((_, i) => (
                <span key={i} style={{ background: i < pw.passed ? pw.color : undefined }} />
              ))}
            </div>
            <div className="inst-pw__read">
              <span className="hint">
                {pw.passed === PW_RULES.length ? t("admin.pw_good") : t("admin.pw_advice")}
              </span>
              <span className="label" style={{ color: pw.color }}>{t(`admin.pw_strength.${pw.level}`)}</span>
            </div>
            <div className="inst-pw__rules">
              {PW_RULES.map((r) => {
                const ok = r.test(admin.password);
                return (
                  <span key={r.id} className={ok ? "is-ok" : ""}>
                    <FontAwesomeIcon icon={ok ? faCheck : faMinus} /> {t(`admin.pw_rules.${r.id}`)}
                  </span>
                );
              })}
            </div>
          </div>
        </div>

        <div className="inst-box inst-tfa">
          <div className="inst-box__body">
            <div className="inst-tfa__head">
              <strong>{t("admin.tfa_title")}</strong>
              <span className="hint">{t("admin.tfa_desc")}</span>
            </div>
            {INSTALL_TWO_FACTOR_GROUPS.map((key) => (
              <label className="inst-tfa__row" key={key}>
                <input
                  type="checkbox"
                  checked={tfaGroups.includes(key)}
                  onChange={(e) => setTfaGroups((g) => e.target.checked ? [...g, key] : g.filter((k) => k !== key))}
                />
                <span>{t(`admin.tfa_groups.${key}`)}</span>
              </label>
            ))}
            {tfaGroups.includes("admin") && <span className="hint">{t("admin.tfa_admin_note")}</span>}
            {tfaGroups.includes("member") && <span className="hint">{t("admin.tfa_member_note")}</span>}
          </div>
        </div>
      </>
    );
  }

  function renderFinalize() {
    const siteRows: [string, string][] = [
      [t("site.site_name"), site.siteName],
      [t("site.site_url"), site.siteUrl],
      [t("site.language"), site.locale.toUpperCase()],
      [t("site.timezone"), site.timezone],
      [t("addons.label"), pickedListings.length ? pickedListings.map((l) => l.name).join(", ") : t("finalize.none")],
    ];
    const adminRows: [string, string][] = [
      [t("admin.email"), admin.email || "—"],
      [t("admin.username"), admin.username || "—"],
      [t("admin.tfa_title"), tfaGroups.length ? INSTALL_TWO_FACTOR_GROUPS.filter((k) => tfaGroups.includes(k)).map((k) => t(`admin.tfa_groups.${k}`)).join(", ") : t("finalize.none")],
      [t("finalize.marketplace"), addons?.connected ? (addons.accountRef ?? t("addons.linked_generic")) : t("addons.not_linked")],
    ];

    return (
      <>
        <h1 className="inst-title">{t("finalize.title")}</h1>
        <p className="inst-lede">{t("finalize.subtitle")}</p>

        {installing ? (
          <div className="inst-box">
            <div className="inst-box__body">
              <div className="inst-progress">
                <div className="inst-progress__head">
                  <span className="t"><FontAwesomeIcon icon={faArrowsRotate} /> {progressText}</span>
                  <span className="pct">{progress}%</span>
                </div>
                <div className="inst-progress__track">
                  <div className="inst-progress__fill" style={{ width: `${progress}%` }} />
                </div>
              </div>
              <div className="inst-log">
                {logLines.map((l, i) => (
                  <div key={i} className={l.tone === "ok" ? "is-ok" : l.tone === "fail" ? "is-fail" : ""}>
                    <span className="t">{l.time}</span>
                    <span className="m">{l.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="inst-box" style={{ marginBottom: 14 }}>
              <div className="inst-box__head"><span className="t"><FontAwesomeIcon icon={faGlobe} /> {t("finalize.site_section")}</span></div>
              {siteRows.map(([k, v]) => (
                <div className="inst-row" key={k}><span className="k">{k}</span><span className="v">{v}</span></div>
              ))}
            </div>
            <div className="inst-box">
              <div className="inst-box__head"><span className="t"><FontAwesomeIcon icon={faUserShield} /> {t("finalize.admin_section")}</span></div>
              {adminRows.map(([k, v]) => (
                <div className="inst-row" key={k}><span className="k">{k}</span><span className="v">{v}</span></div>
              ))}
            </div>
          </>
        )}
      </>
    );
  }

  function renderDone() {
    const initials = (admin.username || admin.email || "A").trim().slice(0, 2).toUpperCase();
    const recapRows: [string, string][] = [
      [t("site.language"), site.locale.toUpperCase()],
      [t("site.timezone"), site.timezone],
      [t("addons.label"), installedAddons.length ? installedAddons.join(", ") : t("finalize.none")],
      [t("finalize.marketplace"), addons?.connected ? (addons.accountRef ?? t("addons.linked_generic")) : t("addons.not_linked")],
      ["Site ID", siteId ?? "—"],
      [t("done.version"), version ?? "—"],
    ];

    return (
      <>
        <div className="inst-done__head">
          <div className="ic"><FontAwesomeIcon icon={faCircleCheck} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 className="inst-title">{t("done.title")}</h1>
            <p>{t("done.subtitle", { site: site.siteName })}</p>
          </div>
        </div>

        <div className="inst-site">
          <div className="inst-site__body">
            <div className="name">{site.siteName}</div>
            <a className="url" href={site.siteUrl}>{site.siteUrl}</a>
            <div className="inst-site__who">
              <div className="av">{initials}</div>
              <div style={{ minWidth: 0 }}>
                <div className="r">{t("done.signed_in")}</div>
                <div className="e">{admin.email || "—"}</div>
              </div>
            </div>
          </div>
          <div className="inst-site__foot">
            <FontAwesomeIcon icon={faCircleCheck} />
            {t("done.summary", {
              duration: duration ?? "—",
              addons: installedAddons.length
                ? t("done.summary_addons", { count: installedAddons.length })
                : t("done.summary_no_addons"),
            })}
          </div>
        </div>

        <div className="inst-done__links">
          <a className="btn is-primary" href="/admin">
            <FontAwesomeIcon icon={faSliders} /> {t("done.goto_admin")}
          </a>
          <a className="btn is-ghost" href="/">
            <FontAwesomeIcon icon={faHouse} /> {t("done.goto_site")}
          </a>
        </div>

        <div className="inst-done__tip">{t("done.tip")}</div>

        <div className="inst-box">
          <button type="button" className="inst-disclose" onClick={() => setRecapOpen((v) => !v)}>
            <FontAwesomeIcon className="lead" icon={faReceipt} />
            <span className="txt"><span className="t">{t("done.details")}</span></span>
            <FontAwesomeIcon className="chev" icon={recapOpen ? faChevronUp : faChevronDown} />
          </button>
          {recapOpen && (
            <div style={{ borderTop: "1px solid var(--border)" }}>
              {recapRows.map(([k, v]) => (
                <div className="inst-row" key={k}><span className="k">{k}</span><span className="v">{v}</span></div>
              ))}
              <div style={{ padding: "14px 18px" }}>
                <button type="button" className="btn is-pill is-sm" onClick={() => copy(recapText(), setRecapCopied)}>
                  <FontAwesomeIcon icon={recapCopied ? faCircleCheck : faCopy} />
                  {recapCopied ? t("addons.copied") : t("done.copy_recap")}
                </button>
              </div>
            </div>
          )}
        </div>
      </>
    );
  }
}

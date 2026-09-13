/**
 * Security — the account's keys, and the devices holding them.
 *
 * ⚠ Every card here keeps its OWN button, and this tab has no save bar. Sending a
 * verification code, changing a username, rotating a password and revoking a session
 * are ACTS with consequences outside this page — three of them sign other sessions
 * out. A bar that batched them behind one "Save changes" would make an irreversible
 * act look like a form field.
 *
 * ⚠ The strip at the top answers "is anything wrong" before you read a single card.
 * Every value in it is real: the PIN state and the session count come from the
 * server, and nothing invents a "password last changed" date the API does not keep.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FontAwesomeIcon } from "../../../components/Icon";
import {
  faKey, faLaptop, faMobileScreen, faEnvelope, faShieldHalved,
} from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { Username } from "../../../components/Username";
import { useAuth, applyLogout } from "../../../hooks/useAuth";
import { authStore } from "../../../lib/authStore";
import { api } from "../../../lib/api";
import { toast } from "../../../lib/toast";
import { apiErrorMessage } from "../../../lib/swal";
import { AccountCard } from "../components/AccountCard";

type PinMode = null | "enable" | "change" | "disable";

interface Session {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
  /** The session this page is being read from. */
  current?: boolean;
}

// ─── Email ───────────────────────────────────────────────────────────────────

function ChangeEmailCard() {
  const { t } = useTranslation("account");
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"request" | "verify">("request");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [code, setCode] = useState("");

  const requestMutation = useMutation({
    mutationFn: (data: { currentPassword: string; newEmail: string }) =>
      api.post<{ codeSent: boolean }>("/account/email", data),
    onSuccess: () => {
      setStep("verify");
      setCurrentPassword("");
    },
    onError: (e) => toast.error(apiErrorMessage(e, t("security.emailFailed"))),
  });

  const verifyMutation = useMutation({
    mutationFn: (data: { code: string }) =>
      api.post<{ email: string }>("/account/email/verify-code", data),
    onSuccess: (res) => {
      if (authStore.user && authStore.token) {
        authStore.set(authStore.token, { ...authStore.user, email: res.email });
      }
      void queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      toast.success(t("security.emailUpdated"));
      setStep("request");
      setNewEmail("");
      setCode("");
    },
    onError: (e) => toast.error(apiErrorMessage(e, t("security.invalidCode"))),
  });

  return (
    <AccountCard
      title={t("security.emailAddress")}
      desc={t("security.emailCardDesc", { email: user?.email ?? "" })}
    >
      {step === "request" ? (
        <form
          className="acct-grid acct-grid--2"
          onSubmit={(e) => {
            e.preventDefault();
            if (newEmail && currentPassword) requestMutation.mutate({ currentPassword, newEmail });
          }}
        >
          <div className="account-field">
            <label className="account-label" htmlFor="sec-email">{t("security.newEmail")}</label>
            <input
              id="sec-email"
              className="account-input"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder={t("security.newEmailPlaceholder")}
              required
            />
          </div>
          <div className="account-field">
            <label className="account-label" htmlFor="sec-email-pw">{t("security.currentPassword")}</label>
            <input
              id="sec-email-pw"
              className="account-input"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>
          <div className="acct-grid__full acct-actions">
            <button
              className="acct-btn acct-btn--primary"
              type="submit"
              disabled={requestMutation.isPending || !newEmail || !currentPassword}
            >
              {requestMutation.isPending ? t("security.sending") : t("security.sendCode")}
            </button>
            {/* 30 minutes, which is what `requestEmailChange` actually stores. */}
            <span className="account-hint">{t("security.codeExpiry")}</span>
          </div>
        </form>
      ) : (
        <form
          className="acct-grid acct-grid--2"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.length === 6) verifyMutation.mutate({ code });
          }}
        >
          <p className="acct-grid__full account-hint">{t("security.codeSent", { email: newEmail })}</p>
          <div className="account-field">
            <label className="account-label" htmlFor="sec-code">{t("security.verifyCode")}</label>
            <input
              id="sec-code"
              className="account-input email-code-input"
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              autoFocus
              required
            />
          </div>
          <div className="acct-grid__full acct-actions">
            <button
              className="acct-btn acct-btn--primary"
              type="submit"
              disabled={verifyMutation.isPending || code.length !== 6}
            >
              {verifyMutation.isPending ? t("security.verifying") : t("security.confirmEmail")}
            </button>
            <button
              type="button"
              className="acct-btn"
              onClick={() => { setStep("request"); setCode(""); }}
              disabled={verifyMutation.isPending}
            >
              {t("security.back")}
            </button>
          </div>
        </form>
      )}
    </AccountCard>
  );
}

// ─── Username ─────────────────────────────────────────────────────────────────

interface HistoryEntry {
  id: string;
  oldUsername: string;
  newUsername: string;
  changedAt: string;
}

function ChangeUsernameCard() {
  const { t } = useTranslation("account");
  const { user } = useAuth();
  const [username, setUsername] = useState("");

  const mutation = useMutation({
    mutationFn: (u: string) => api.patch<{ username: string }>("/account/username", { username: u }),
    onSuccess: (res) => {
      authStore.set(authStore.token!, { ...authStore.user!, username: res.username });
      setUsername("");
      toast.success(t("security.usernameUpdated"));
    },
    onError: (e) => toast.error(apiErrorMessage(e, t("security.usernameFailed"))),
  });

  /** ⚠ In the SAME card as the change form — the history is the answer to "can I
   *  change it yet", which was previously an accordion away from the question. */
  const { data: history } = useQuery({
    queryKey: ["account", "username-history"],
    queryFn: () => api.get<HistoryEntry[]>("/account/username-history"),
  });

  return (
    <AccountCard
      title={t("security.changeUsername")}
      desc={t("security.usernameCardDesc")}
    >
      <p className="account-hint">
        {t("security.current")}:{" "}
        <strong>@<Username username={user?.username ?? ""} badgeColor={user?.visibleGroups[0]?.badgeColor} /></strong>
      </p>
      <form
        className="acct-inline"
        onSubmit={(e) => {
          e.preventDefault();
          if (username.trim()) mutation.mutate(username.trim());
        }}
      >
        <input
          className="account-input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder={t("security.newUsernamePlaceholder")}
          aria-label={t("security.newUsernamePlaceholder")}
          minLength={3}
          maxLength={30}
          pattern="[a-zA-Z0-9_-]+"
        />
        <button className="acct-btn acct-btn--primary" type="submit" disabled={!username.trim() || mutation.isPending}>
          {mutation.isPending ? t("security.changing") : t("security.change")}
        </button>
      </form>

      <div className="acct-panel">
        <span className="acct-panel__label">{t("security.usernameHistory")}</span>
        {history?.length
          ? history.map((h) => (
              <div key={h.id} className="acct-panel__row">
                <span className="acct-was">@{h.oldUsername}</span>
                <span className="acct-arrow">→</span>
                <span className="acct-now">@{h.newUsername}</span>
                <span className="acct-when">{new Date(h.changedAt).toLocaleDateString()}</span>
              </div>
            ))
          : <p className="account-hint">{t("security.noHistory")}</p>}
      </div>
    </AccountCard>
  );
}

// ─── Password ─────────────────────────────────────────────────────────────────

function ChangePasswordCard() {
  const { t } = useTranslation("account");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const mutation = useMutation({
    mutationFn: (data: { currentPassword: string; newPassword: string }) =>
      api.post("/account/password", data),
    onSuccess: () => {
      setCurrent(""); setNext(""); setConfirm("");
      toast.success(t("security.passwordChanged"));
    },
    onError: (e) => toast.error(apiErrorMessage(e, t("security.passwordFailed"))),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) return;
    mutation.mutate({ currentPassword: current, newPassword: next });
  }

  return (
    <AccountCard title={t("security.changePasswordTitle")} desc={t("security.passwordCardDesc")}>
      <form className="acct-grid acct-grid--3" onSubmit={handleSubmit}>
        <div className="account-field">
          <label className="account-label" htmlFor="pw-cur">{t("security.currentPassword")}</label>
          <input id="pw-cur" className="account-input" type="password" required
            value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div className="account-field">
          <label className="account-label" htmlFor="pw-new">{t("security.newPassword")}</label>
          <input id="pw-new" className="account-input" type="password" minLength={8} required
            value={next} onChange={(e) => setNext(e.target.value)} />
        </div>
        <div className="account-field">
          <label className="account-label" htmlFor="pw-conf">{t("security.confirmNewPassword")}</label>
          <input id="pw-conf" className="account-input" type="password" required
            value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          {confirm && next !== confirm && <p className="account-error">{t("security.passwordMismatch")}</p>}
        </div>
        <div className="acct-grid__full acct-actions">
          <button className="acct-btn acct-btn--primary" type="submit"
            disabled={mutation.isPending || next !== confirm || !current}>
            {mutation.isPending ? t("security.changing") : t("security.changePassword")}
          </button>
        </div>
      </form>
    </AccountCard>
  );
}

// ─── PIN ──────────────────────────────────────────────────────────────────────

function LoginPinCard() {
  const { t } = useTranslation("account");
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const enabled = !!user?.loginPinEnabled;

  const [mode, setMode] = useState<PinMode>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [pin, setPin] = useState("");

  function reset() {
    setMode(null);
    setCurrentPassword("");
    setPin("");
  }

  function refreshUser(nextEnabled: boolean) {
    if (authStore.user) {
      authStore.set(authStore.token!, { ...authStore.user, loginPinEnabled: nextEnabled });
    }
    void queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
  }

  const setMutation = useMutation({
    mutationFn: (data: { currentPassword: string; pin: string }) => api.post("/account/pin", data),
    onSuccess: () => {
      refreshUser(true);
      const message = mode === "change" ? t("security.pinChanged") : t("security.pinEnabled");
      reset();
      toast.success(message);
    },
    onError: (e) => toast.error(apiErrorMessage(e, t("security.pinFailed"))),
  });

  const disableMutation = useMutation({
    mutationFn: (data: { currentPassword: string }) => api.delete("/account/pin", data),
    onSuccess: () => {
      refreshUser(false);
      reset();
      toast.success(t("security.pinDisabled"));
    },
    onError: (e) => toast.error(apiErrorMessage(e, t("security.pinFailed"))),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "disable") {
      disableMutation.mutate({ currentPassword });
    } else {
      if (!/^\d{4}$/.test(pin)) return;
      setMutation.mutate({ currentPassword, pin });
    }
  }

  const isPending = setMutation.isPending || disableMutation.isPending;

  return (
    <AccountCard
      title={t("security.loginPin")}
      desc={enabled ? t("security.pinEnabledDesc") : t("security.pinDisabledDesc")}
    >
      {mode === null && (
        <div className="acct-actions">
          {enabled ? (
            <>
              <button className="acct-btn acct-btn--primary" type="button" onClick={() => setMode("change")}>
                {t("security.changePin")}
              </button>
              <button className="acct-btn" type="button" onClick={() => setMode("disable")}>
                {t("security.disablePin")}
              </button>
            </>
          ) : (
            <button className="acct-btn acct-btn--primary" type="button" onClick={() => setMode("enable")}>
              {t("security.enablePin")}
            </button>
          )}
        </div>
      )}

      {mode !== null && (
        <form className="acct-grid acct-grid--2" onSubmit={handleSubmit}>
          <div className="account-field">
            <label className="account-label" htmlFor="pin-pw">{t("security.currentPassword")}</label>
            <input id="pin-pw" className="account-input" type="password" required autoFocus
              value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </div>

          {mode !== "disable" && (
            <div className="account-field">
              <label className="account-label" htmlFor="pin-code">
                {mode === "change" ? t("security.newPinLabel") : t("security.pinLabel")}
              </label>
              <input
                id="pin-code"
                className="account-input"
                type="password"
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                required
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              />
            </div>
          )}

          <div className="acct-grid__full acct-actions">
            <button
              className={`acct-btn ${mode === "disable" ? "acct-btn--danger" : "acct-btn--primary"}`}
              type="submit"
              disabled={isPending || !currentPassword || (mode !== "disable" && pin.length !== 4)}
            >
              {isPending
                ? t("security.saving")
                : mode === "disable"
                  ? t("security.disablePin")
                  : mode === "change"
                    ? t("security.changePin")
                    : t("security.enablePin")}
            </button>
            <button className="acct-btn" type="button" onClick={reset} disabled={isPending}>
              {t("security.cancel")}
            </button>
          </div>
        </form>
      )}
    </AccountCard>
  );
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

/** Desktop or phone, from the UA string. DISPLAY ONLY — nothing is gated on it. */
function deviceIcon(ua: string | null): IconDefinition {
  return ua && /Mobi|Android|iPhone|iPad/i.test(ua) ? faMobileScreen : faLaptop;
}

/** "Chrome 141 · macOS" out of a user-agent, falling back to the raw string. */
export function deviceName(ua: string | null, unknown: string): string {
  if (!ua) return unknown;
  /**
   * ⚠ Most specific FIRST, and one test each — not one alternation.
   *
   * A regex alternation matches at the earliest POSITION, not by priority, and
   * Edge's user-agent reads "… Chrome/140 … Edg/140": one pattern reported every
   * Edge and every Opera as Chrome. Safari's own version lives in `Version/`; its
   * `Safari/` number is the WebKit build.
   */
  const BROWSERS: [RegExp, string][] = [
    [/Edg\/(\d+)/, "Edge"],
    [/OPR\/(\d+)/, "Opera"],
    [/Firefox\/(\d+)/, "Firefox"],
    [/Chrome\/(\d+)/, "Chrome"],
    [/Version\/(\d+).*Safari/, "Safari"],
    [/Safari\/(\d+)/, "Safari"],
  ];
  let browser: [string, string] | null = null;
  for (const [re, label] of BROWSERS) {
    const m = ua.match(re);
    if (m) { browser = [label, m[1]!]; break; }
  }
  /**
   * ⚠ iOS BEFORE macOS. An iPhone's user-agent says "like Mac OS X", so testing for
   * Mac first reports every iPhone and iPad as a Mac — which is the one thing a
   * member looks at this list to tell apart. Android before Linux, for the same
   * reason.
   */
  const os = /Windows/i.test(ua) ? "Windows"
    : /(iPhone|iPad|iPod|iOS)/i.test(ua) ? "iOS"
    : /Android/i.test(ua) ? "Android"
    : /Mac OS X/i.test(ua) ? "macOS"
    : /Linux/i.test(ua) ? "Linux"
    : null;
  const name = browser ? `${browser[0]} ${browser[1]}` : null;
  if (!name && !os) return ua.slice(0, 60);
  return [name, os].filter(Boolean).join(" · ");
}

function SessionsCard() {
  const { t } = useTranslation("account");
  const queryClient = useQueryClient();
  const { data: sessions, isLoading } = useQuery({
    queryKey: ["account", "sessions"],
    queryFn: () => api.get<Session[]>("/account/sessions"),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/account/sessions/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["account", "sessions"] }),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const signOutAllMutation = useMutation({
    mutationFn: async () => {
      await api.post("/auth/logout");
      applyLogout();
    },
  });

  return (
    <AccountCard
      title={t("security.activeSessions")}
      desc={t("security.sessionsDesc")}
      aside={
        <button className="acct-btn acct-btn--danger-ghost" type="button"
          onClick={() => signOutAllMutation.mutate()}>
          {t("security.signOutEverywhere")}
        </button>
      }
    >
      {isLoading && <p className="account-hint">{t("security.loadingSessions")}</p>}
      <div className="acct-sessions">
        {sessions?.map((s) => (
          <div key={s.id} className="acct-session">
            <span className="acct-session__icon">
              <FontAwesomeIcon className="acct-ic" icon={deviceIcon(s.userAgent)} />
            </span>
            <span className="acct-session__id">
              <span className="acct-session__device">
                {deviceName(s.userAgent, t("security.unknownDevice"))}
              </span>
              <span className="acct-session__meta">
                {s.ip ?? t("security.unknownIp")} · {t("security.lastActive", { date: new Date(s.lastUsedAt).toLocaleDateString() })}
              </span>
            </span>
            {/* ⚠ The current session offers no Revoke: it is the session reading this
                page, and "sign out everywhere" in the header is the deliberate way
                to end it. */}
            {s.current
              ? <span className="acct-tag acct-tag--ok">{t("security.thisDevice")}</span>
              : <button className="acct-btn acct-btn--sm" type="button"
                  onClick={() => revokeMutation.mutate(s.id)} disabled={revokeMutation.isPending}>
                  {t("security.revoke")}
                </button>}
          </div>
        ))}
        {sessions?.length === 0 && <p className="account-hint">{t("security.noSessions")}</p>}
      </div>
    </AccountCard>
  );
}

// ─── Tab ──────────────────────────────────────────────────────────────────────

export function SecurityTab() {
  const { t } = useTranslation("account");
  const { user } = useAuth();
  const { data: sessions } = useQuery({
    queryKey: ["account", "sessions"],
    queryFn: () => api.get<Session[]>("/account/sessions"),
  });

  /** The strip: three real facts, each with the card that changes it below. */
  const status = [
    {
      id: "pin", icon: faKey, tone: user?.loginPinEnabled ? "ok" : "warn",
      label: t("security.loginPin"),
      value: user?.loginPinEnabled ? t("security.stateOn") : t("security.stateOff"),
    },
    {
      id: "sessions", icon: faLaptop, tone: "info",
      label: t("security.activeSessions"),
      value: sessions ? t("security.deviceCount", { count: sessions.length }) : "—",
    },
    {
      id: "email", icon: faEnvelope, tone: "ok",
      label: t("security.emailAddress"),
      value: user?.email ?? "—",
    },
  ];

  return (
    <>
      <div className="acct-status">
        {status.map((s) => (
          <div key={s.id} className="acct-status__card">
            <span className={`acct-status__chip is-${s.tone}`}><FontAwesomeIcon className="acct-ic" icon={s.icon} /></span>
            <span className="acct-status__label">{s.label}</span>
            <span className="acct-status__value">{s.value}</span>
          </div>
        ))}
      </div>

      <ChangeEmailCard />
      <ChangeUsernameCard />
      <ChangePasswordCard />
      <LoginPinCard />
      <SessionsCard />

      <p className="account-hint acct-foot">
        <FontAwesomeIcon className="acct-ic" icon={faShieldHalved} /> {t("security.footNote")}
      </p>
    </>
  );
}

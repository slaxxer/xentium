import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AccordionSection } from "../../../components/AccordionSection";
import { Username } from "../../../components/Username";
import { useAuth, applyLogout } from "../../../hooks/useAuth";
import { authStore } from "../../../lib/authStore";
import { api } from "../../../lib/api";
import { swalToast, apiErrorMessage } from "../../../lib/swal";

type PinMode = null | "enable" | "change" | "disable";

// ─── Email ───────────────────────────────────────────────────────────────────

function ChangeEmailForm() {
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
    onError: (e) => swalToast(apiErrorMessage(e, t("security.emailFailed"))),
  });

  const verifyMutation = useMutation({
    mutationFn: (data: { code: string }) =>
      api.post<{ email: string }>("/account/email/verify-code", data),
    onSuccess: (res) => {
      if (authStore.user && authStore.token) {
        authStore.set(authStore.token, { ...authStore.user, email: res.email });
      }
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      swalToast(t("security.emailUpdated"), "success");
      setStep("request");
      setNewEmail("");
      setCode("");
    },
    onError: (e) => swalToast(apiErrorMessage(e, t("security.invalidCode"))),
  });

  return (
    <div className="security-accordion__content">
      <p className="account-hint" style={{ marginBottom: "var(--sp-4)" }}>
        {t("security.current")}: <strong>{user?.email}</strong>
      </p>

      {step === "request" ? (
        <form
          className="account-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (newEmail && currentPassword) requestMutation.mutate({ currentPassword, newEmail });
          }}
        >
          <div className="account-field">
            <label className="account-label">{t("security.newEmail")}</label>
            <input
              className="account-input"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder={t("security.newEmailPlaceholder")}
              required
            />
          </div>
          <div className="account-field">
            <label className="account-label">{t("security.currentPassword")}</label>
            <input
              className="account-input"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>
          <div className="account-actions">
            <button
              className="btn-primary"
              type="submit"
              disabled={requestMutation.isPending || !newEmail || !currentPassword}
            >
              {requestMutation.isPending ? t("security.sending") : t("security.sendCode")}
            </button>
          </div>
        </form>
      ) : (
        <form
          className="account-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.length === 6) verifyMutation.mutate({ code });
          }}
        >
          <p className="account-hint" style={{ marginBottom: "var(--sp-4)" }}>
            {t("security.codeSent", { email: newEmail })}
          </p>
          <div className="account-field">
            <label className="account-label">{t("security.verifyCode")}</label>
            <input
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
          <div className="account-actions">
            <button
              className="btn-primary"
              type="submit"
              disabled={verifyMutation.isPending || code.length !== 6}
            >
              {verifyMutation.isPending ? t("security.verifying") : t("security.confirmEmail")}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => { setStep("request"); setCode(""); }}
              disabled={verifyMutation.isPending}
            >
              {t("security.back")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ─── Username ─────────────────────────────────────────────────────────────────

function ChangeUsernameForm() {
  const { t } = useTranslation("account");
  const { user } = useAuth();
  const [username, setUsername] = useState("");

  const mutation = useMutation({
    mutationFn: (u: string) => api.patch<{ username: string }>("/account/username", { username: u }),
    onSuccess: (res) => {
      authStore.set(authStore.token!, { ...authStore.user!, username: res.username });
      setUsername("");
      swalToast(t("security.usernameUpdated"), "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e, t("security.usernameFailed"))),
  });

  return (
    <div className="security-accordion__content">
      <p className="account-hint">
        {t("security.current")}: <strong>@<Username username={user?.username ?? ""} badgeColor={user?.visibleGroups[0]?.badgeColor} /></strong>. {t("security.usernameCooldownNote")}
      </p>
      <form
        className="account-inline-form"
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
          minLength={3}
          maxLength={30}
          pattern="[a-zA-Z0-9_-]+"
        />
        <button className="btn-primary" type="submit" disabled={!username.trim() || mutation.isPending}>
          {mutation.isPending ? t("security.changing") : t("security.change")}
        </button>
      </form>
    </div>
  );
}

// ─── Password ─────────────────────────────────────────────────────────────────

function ChangePasswordForm() {
  const { t } = useTranslation("account");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const mutation = useMutation({
    mutationFn: (data: { currentPassword: string; newPassword: string }) =>
      api.post("/account/password", data),
    onSuccess: () => {
      setCurrent(""); setNext(""); setConfirm("");
      swalToast(t("security.passwordChanged"), "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e, t("security.passwordFailed"))),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) return;
    mutation.mutate({ currentPassword: current, newPassword: next });
  }

  return (
    <div className="security-accordion__content">
      <form className="account-form" onSubmit={handleSubmit}>
        <div className="account-field">
          <label className="account-label">{t("security.currentPassword")}</label>
          <input
            className="account-input"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        </div>
        <div className="account-field">
          <label className="account-label">{t("security.newPassword")}</label>
          <input
            className="account-input"
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            minLength={8}
            required
          />
        </div>
        <div className="account-field">
          <label className="account-label">{t("security.confirmNewPassword")}</label>
          <input
            className="account-input"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
          {confirm && next !== confirm && <p className="account-error">{t("security.passwordMismatch")}</p>}
        </div>
        <div className="account-actions">
          <button
            className="btn-primary"
            type="submit"
            disabled={mutation.isPending || next !== confirm || !current}
          >
            {mutation.isPending ? t("security.changing") : t("security.changePassword")}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── PIN ──────────────────────────────────────────────────────────────────────

function LoginPinForm() {
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
    queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
  }

  const setMutation = useMutation({
    mutationFn: (data: { currentPassword: string; pin: string }) =>
      api.post("/account/pin", data),
    onSuccess: () => {
      refreshUser(true);
      const message = mode === "change" ? t("security.pinChanged") : t("security.pinEnabled");
      reset();
      swalToast(message, "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e, t("security.pinFailed"))),
  });

  const disableMutation = useMutation({
    mutationFn: (data: { currentPassword: string }) => api.delete("/account/pin", data),
    onSuccess: () => {
      refreshUser(false);
      reset();
      swalToast(t("security.pinDisabled"), "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e, t("security.pinFailed"))),
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
    <div className="security-accordion__content">
      <p className="account-hint">
        {enabled ? t("security.pinEnabledDesc") : t("security.pinDisabledDesc")}
      </p>

      {mode === null && (
        <div className="account-actions" style={{ marginTop: "var(--sp-4)" }}>
          {enabled ? (
            <>
              <button className="btn-primary" type="button" onClick={() => setMode("change")}>
                {t("security.changePin")}
              </button>
              <button className="btn-ghost" type="button" onClick={() => setMode("disable")}>
                {t("security.disablePin")}
              </button>
            </>
          ) : (
            <button className="btn-primary" type="button" onClick={() => setMode("enable")}>
              {t("security.enablePin")}
            </button>
          )}
        </div>
      )}

      {mode !== null && (
        <form className="account-form" onSubmit={handleSubmit} style={{ marginTop: "var(--sp-4)" }}>
          <div className="account-field">
            <label className="account-label">{t("security.currentPassword")}</label>
            <input
              className="account-input"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoFocus
            />
          </div>

          {mode !== "disable" && (
            <div className="account-field">
              <label className="account-label">
                {mode === "change" ? t("security.newPinLabel") : t("security.pinLabel")}
              </label>
              <input
                className="account-input"
                type="password"
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                required
              />
            </div>
          )}

          <div className="account-actions">
            <button
              className={mode === "disable" ? "btn-danger" : "btn-primary"}
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
            <button className="btn-ghost" type="button" onClick={reset} disabled={isPending}>
              {t("security.cancel")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

interface Session {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
}

function SessionsList() {
  const { t } = useTranslation("account");
  const queryClient = useQueryClient();
  const { data: sessions, isLoading } = useQuery({
    queryKey: ["account", "sessions"],
    queryFn: () => api.get<Session[]>("/account/sessions"),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/account/sessions/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["account", "sessions"] }),
  });

  const signOutAllMutation = useMutation({
    mutationFn: async () => {
      await api.post("/auth/logout");
      applyLogout();
    },
  });

  if (isLoading) return <p className="account-hint">{t("security.loadingSessions")}</p>;

  return (
    <div className="security-accordion__content">
      <div className="account-card__header" style={{ marginBottom: "var(--sp-4)" }}>
        <span />
        <button className="btn-ghost btn-sm" type="button" onClick={() => signOutAllMutation.mutate()}>
          {t("security.signOutEverywhere")}
        </button>
      </div>
      <div className="account-sessions">
        {sessions?.map((s) => (
          <div key={s.id} className="account-session">
            <div className="account-session__info">
              <span className="account-session__ua">
                {s.userAgent ? s.userAgent.slice(0, 60) : t("security.unknownDevice")}
              </span>
              <span className="account-session__meta">
                {s.ip ?? t("security.unknownIp")} · {t("security.lastActive", { date: new Date(s.lastUsedAt).toLocaleDateString() })}
              </span>
            </div>
            <button
              className="btn-ghost btn-sm"
              type="button"
              onClick={() => revokeMutation.mutate(s.id)}
              disabled={revokeMutation.isPending}
            >
              {t("security.revoke")}
            </button>
          </div>
        ))}
        {sessions?.length === 0 && <p className="account-hint">{t("security.noSessions")}</p>}
      </div>
    </div>
  );
}

// ─── Username History ─────────────────────────────────────────────────────────

interface HistoryEntry {
  id: string;
  oldUsername: string;
  newUsername: string;
  changedAt: string;
}

function UsernameHistoryList() {
  const { t } = useTranslation("account");
  const { data: history } = useQuery({
    queryKey: ["account", "username-history"],
    queryFn: () => api.get<HistoryEntry[]>("/account/username-history"),
  });

  if (!history?.length) {
    return (
      <div className="security-accordion__content">
        <p className="account-hint">{t("security.noHistory")}</p>
      </div>
    );
  }

  return (
    <div className="security-accordion__content">
      <div className="account-history">
        {history.map((h) => (
          <div key={h.id} className="account-history__item">
            <span className="account-history__old">@{h.oldUsername}</span>
            <span className="account-history__arrow">→</span>
            <span className="account-history__new">@{h.newUsername}</span>
            <span className="account-history__date">{new Date(h.changedAt).toLocaleDateString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Tab ──────────────────────────────────────────────────────────────────────

export function SecurityTab() {
  const { t } = useTranslation("account");
  return (
    <section className="account-section">
      <h2 className="account-section__title">{t("security.title")}</h2>

      <div className="security-accordion-list">
        <AccordionSection title={t("security.emailAddress")} defaultOpen={true}>
          <ChangeEmailForm />
        </AccordionSection>

        <AccordionSection title={t("security.changeUsername")}>
          <ChangeUsernameForm />
        </AccordionSection>

        <AccordionSection title={t("security.changePasswordTitle")}>
          <ChangePasswordForm />
        </AccordionSection>

        <AccordionSection title={t("security.loginPin")}>
          <LoginPinForm />
        </AccordionSection>

        <AccordionSection title={t("security.activeSessions")}>
          <SessionsList />
        </AccordionSection>

        <AccordionSection title={t("security.usernameHistory")}>
          <UsernameHistoryList />
        </AccordionSection>
      </div>
    </section>
  );
}

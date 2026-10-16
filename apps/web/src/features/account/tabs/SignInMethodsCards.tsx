/**
 * Passkeys and connected sign-in providers, on the Security tab.
 *
 * Each row is an act with its own button (no save bar, as for every card on
 * this tab). Removing the last way into an account is refused by the server;
 * the button says why rather than failing mysteriously.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { faDiscord, faGithub, faGoogle } from "@fortawesome/free-brands-svg-icons";
import { faFingerprint, faPen, faTrash } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../../components/Icon";
import { useAuth } from "../../../hooks/useAuth";
import { api } from "../../../lib/api";
import { toast } from "../../../lib/toast";
import { openDialog } from "../../../lib/dialog";
import { apiErrorMessage } from "../../../lib/swal";
import { AccountCard } from "../components/AccountCard";
import { addPasskey, deviceName, isPasskeyCancel, passkeysSupported } from "../../auth/doorway/signInClient";
import { useDateTime } from "../../../lib/datetime";

type Provider = "google" | "github" | "discord";

export interface MySignInMethods {
  password: boolean;
  passkeys: Array<{ id: string; name: string; synced: boolean; createdAt: string; lastUsedAt: string | null }>;
  providers: Array<{ provider: Provider; email: string | null; createdAt: string; lastUsedAt: string | null }>;
  available: { passkeys: boolean; providers: Provider[] };
}

const KEY = ["account", "sign-in-methods"];
export const useSignInMethods = () => useQuery<MySignInMethods>({ queryKey: KEY, queryFn: () => api.get("/auth/sign-in-methods") });

const PROVIDER = {
  google: { name: "Google", icon: faGoogle },
  github: { name: "GitHub", icon: faGithub },
  discord: { name: "Discord", icon: faDiscord },
} as const;

/** In the site's time settings (ACP → System Settings). */
function useDate() {
  return useDateTime().date;
}

export function PasskeysCard() {
  const { t } = useTranslation("account");
  const qc = useQueryClient();
  const date = useDate();
  const { data } = useSignInMethods();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: KEY });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/auth/passkeys/${id}`),
    onSuccess: () => { void refresh(); toast.success(t("signin.passkeyRemoved")); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.patch(`/auth/passkeys/${id}`, { name }),
    onSuccess: () => { setEditing(null); void refresh(); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  if (!data?.available.passkeys) return null;
  const supported = passkeysSupported();

  const add = async () => {
    setAdding(true);
    try {
      await addPasskey(deviceName());
      await refresh();
      toast.success(t("signin.passkeyAdded"));
    } catch (err) {
      if (!isPasskeyCancel(err)) toast.error(apiErrorMessage(err, t("signin.passkeyFailed")));
    } finally { setAdding(false); }
  };

  const confirmRemove = async (id: string, name: string) => {
    if (await openDialog({
      kind: "confirm", icon: "warning", danger: true, title: t("signin.removePasskeyTitle", { name }),
      body: t("signin.removePasskeyBody"), confirmText: t("signin.remove"), cancelText: t("signin.cancel"),
    })) remove.mutate(id);
  };


  return (
    <AccountCard title={t("signin.passkeysTitle")} desc={t("signin.passkeysDesc")}>
      {data.passkeys.length === 0 && <p className="account-hint">{t("signin.noPasskeys")}</p>}
      <div className="acct-sessions">
        {data.passkeys.map((p) => (
          <div key={p.id} className="acct-session">
            <span className="acct-session__icon"><FontAwesomeIcon className="acct-ic" icon={faFingerprint} /></span>
            {editing?.id === p.id ? (
              <form className="acct-session__id acct-inline" onSubmit={(e) => {
                e.preventDefault();
                const name = editing.name.trim();
                if (name && name !== p.name) rename.mutate({ id: p.id, name }); else setEditing(null);
              }}>
                <input className="account-input" value={editing.name} maxLength={60} autoFocus aria-label={t("signin.rename")}
                  onChange={(e) => setEditing({ id: p.id, name: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Escape") setEditing(null); }} />
                <button type="submit" className="acct-btn acct-btn--sm acct-btn--primary" disabled={rename.isPending}>{t("signin.save")}</button>
                <button type="button" className="acct-btn acct-btn--sm" onClick={() => setEditing(null)}>{t("signin.cancel")}</button>
              </form>
            ) : (
              <span className="acct-session__id">
                <span className="acct-session__device">{p.name}</span>
                <span className="acct-session__meta">
                  {p.synced ? t("signin.synced") : t("signin.thisDevice")} · {t("signin.added", { date: date(p.createdAt) })}
                  {p.lastUsedAt ? ` · ${t("signin.lastUsed", { date: date(p.lastUsedAt) })}` : ""}
                </span>
              </span>
            )}
            {editing?.id !== p.id && (
              <button type="button" className="acct-btn acct-btn--sm" onClick={() => setEditing({ id: p.id, name: p.name })} aria-label={t("signin.rename")}>
                <FontAwesomeIcon icon={faPen} />
              </button>
            )}
            <button type="button" className="acct-btn acct-btn--sm acct-btn--danger-ghost" disabled={remove.isPending}
              onClick={() => void confirmRemove(p.id, p.name)} aria-label={t("signin.remove")}>
              <FontAwesomeIcon icon={faTrash} />
            </button>
          </div>
        ))}
      </div>
      <div className="acct-actions">
        <button type="button" className="acct-btn acct-btn--primary" disabled={adding || !supported} onClick={() => void add()}>
          {adding ? t("signin.adding") : t("signin.addPasskey")}
        </button>
        {!supported && <span className="account-hint">{t("signin.passkeyUnsupported")}</span>}
      </div>
    </AccountCard>
  );
}

export function ConnectedAccountsCard() {
  const { t } = useTranslation("account");
  const qc = useQueryClient();
  const date = useDate();
  const [params, setParams] = useSearchParams();
  const { data } = useSignInMethods();

  // Coming back from a provider: say what happened once, then tidy the URL.
  useEffect(() => {
    const connected = params.get("connected");
    const failed = params.get("oauthError");
    if (!connected && !failed) return;
    if (connected) toast.success(t("signin.connected", { provider: PROVIDER[connected as Provider]?.name ?? connected }));
    if (failed) toast.error(failed === "XEC-AUTH-1061" ? t("signin.connectTaken") : t("signin.connectFailed"));
    const next = new URLSearchParams(params);
    next.delete("connected"); next.delete("oauthError");
    setParams(next, { replace: true });
    void qc.invalidateQueries({ queryKey: KEY });
  }, [params, setParams, t, qc]);

  const link = useMutation({
    mutationFn: (p: Provider) => api.post<{ url: string }>(`/auth/oauth/${p}/link`, { returnTo: "/account?tab=security" }),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const unlink = useMutation({
    mutationFn: (p: Provider) => api.delete(`/auth/oauth/${p}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: KEY }); toast.success(t("signin.disconnected")); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  if (!data) return null;
  const linked = new Map(data.providers.map((p) => [p.provider, p]));
  const shown = [...new Set<Provider>([...data.available.providers, ...data.providers.map((p) => p.provider)])];
  if (shown.length === 0) return null;

  return (
    <AccountCard title={t("signin.providersTitle")} desc={t("signin.providersDesc")}>
      <div className="acct-sessions">
        {shown.map((p) => {
          const row = linked.get(p);
          return (
            <div key={p} className="acct-session">
              <span className="acct-session__icon"><FontAwesomeIcon className="acct-ic" icon={PROVIDER[p].icon} /></span>
              <span className="acct-session__id">
                <span className="acct-session__device">{PROVIDER[p].name}</span>
                <span className="acct-session__meta">
                  {row ? `${row.email ?? t("signin.connectedShort")} · ${t("signin.added", { date: date(row.createdAt) })}` : t("signin.notConnected")}
                </span>
              </span>
              {row ? (
                <button type="button" className="acct-btn acct-btn--sm" disabled={unlink.isPending} onClick={() => unlink.mutate(p)}>{t("signin.disconnect")}</button>
              ) : (
                <button type="button" className="acct-btn acct-btn--sm acct-btn--primary" disabled={link.isPending || !data.available.providers.includes(p)}
                  onClick={() => link.mutate(p)}>{t("signin.connect")}</button>
              )}
            </div>
          );
        })}
      </div>
    </AccountCard>
  );
}

/** Shown in place of "change password" for an account that has none (made through a provider). */
export function SetPasswordHint() {
  const { t } = useTranslation("account");
  const { user } = useAuth();
  const send = useMutation({
    mutationFn: () => api.post("/auth/password-reset", { email: user?.email }),
    onSuccess: () => toast.success(t("signin.setPasswordSent", { email: user?.email ?? "" })),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  return (
    <AccountCard title={t("security.changePasswordTitle")} desc={t("signin.noPasswordDesc")}>
      <div className="acct-actions">
        <button type="button" className="acct-btn acct-btn--primary" disabled={send.isPending || !user?.email} onClick={() => send.mutate()}>
          {t("signin.setPassword")}
        </button>
      </div>
    </AccountCard>
  );
}

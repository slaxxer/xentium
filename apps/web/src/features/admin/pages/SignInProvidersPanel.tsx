import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { faDiscord, faGithub, faGoogle } from "@fortawesome/free-brands-svg-icons";
import { faCheck, faCopy, faFingerprint } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../../components/Icon";
import { Toggle } from "../../../components/AcpControls";
import { useAutosave, useReportSaving } from "../../../hooks/useAutosave";
import { api } from "../../../lib/api";
import { toast } from "../../../lib/toast";
import { apiErrorMessage } from "../../../lib/swal";

// ACP → Settings → Login: sign-in providers and passkeys.
//
// The toggle and client id autosave, reporting into the page's one indicator.
// The secret does NOT: a half-typed secret must never be saved, so it has an
// explicit Set / Remove, and the server never sends it back — only whether one
// is set (docs/plugin-acp-autosave.md, the secrets exception).

type Provider = "google" | "github" | "discord";
interface ProviderRow { provider: Provider; enabled: boolean; clientId: string; secretSet: boolean; callbackUrl: string }
interface Response { providers: ProviderRow[]; passkeys: { rpID: string; origin: string; available: boolean } }

const META = {
  google: { name: "Google", icon: faGoogle, console: "https://console.cloud.google.com/apis/credentials" },
  github: { name: "GitHub", icon: faGithub, console: "https://github.com/settings/developers" },
  discord: { name: "Discord", icon: faDiscord, console: "https://discord.com/developers/applications" },
} as const;

export function SignInProvidersPanel() {
  const { t } = useTranslation("acp");
  const { data } = useQuery<Response>({ queryKey: ["acp-auth-providers"], queryFn: () => api.get("/admin/auth-providers") });
  if (!data) return null;
  return (
    <div className="sp">
      <div className="sp-passkeys">
        <FontAwesomeIcon icon={faFingerprint} />
        <div>
          <div className="set-row__label">{t("signInProviders.passkeysTitle")}</div>
          <div className="set-row__desc">
            {data.passkeys.available
              ? t("signInProviders.passkeysOn", { host: data.passkeys.rpID })
              : t("signInProviders.passkeysOff", { origin: data.passkeys.origin })}
          </div>
        </div>
      </div>
      {data.providers.map((row) => <ProviderCard key={row.provider} row={row} />)}
    </div>
  );
}

function ProviderCard({ row }: { row: ProviderRow }) {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const meta = META[row.provider];
  const saved = { enabled: row.enabled, clientId: row.clientId };
  const [draft, setDraft] = useState(saved);
  const [secret, setSecret] = useState("");
  const [copied, setCopied] = useState(false);

  // A refetch (after a secret change, say) re-seeds the form from the server.
  useEffect(() => { setDraft({ enabled: row.enabled, clientId: row.clientId }); }, [row.enabled, row.clientId]);

  const patch = useMutation({
    mutationFn: (body: Partial<{ enabled: boolean; clientId: string; clientSecret: string | null }>) =>
      api.patch<Response>(`/admin/auth-providers/${row.provider}`, body),
    onSuccess: (fresh) => qc.setQueryData<Response>(["acp-auth-providers"], (old) => old && { ...old, providers: fresh.providers }),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  useReportSaving(patch.isPending);
  useAutosave({ value: draft, savedValue: saved, onSave: (v) => patch.mutate(v) });

  const ready = !!row.clientId && row.secretSet;
  const copy = () => {
    void navigator.clipboard?.writeText(row.callbackUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="sp-card">
      <div className="sp-card__head">
        <span className="sp-card__icon"><FontAwesomeIcon icon={meta.icon} /></span>
        <div className="sp-card__titles">
          <strong>{meta.name}</strong>
          <span className="set-row__desc">
            {draft.enabled && ready ? t("signInProviders.live") : draft.enabled ? t("signInProviders.incomplete") : t("signInProviders.off")}
          </span>
        </div>
        <Toggle on={draft.enabled} onToggle={() => setDraft((d) => ({ ...d, enabled: !d.enabled }))} />
      </div>

      <div className="sp-grid">
        <label className="sp-field">
          <span className="set-row__label">{t("signInProviders.clientId")}</span>
          <input className="inp" value={draft.clientId} onChange={(e) => { const clientId = e.target.value; setDraft((d) => ({ ...d, clientId })); }} spellCheck={false} />
        </label>
        <div className="sp-field">
          <span className="set-row__label">{t("signInProviders.clientSecret")}</span>
          {row.secretSet ? (
            <div className="sp-inline">
              <span className="sp-secret"><FontAwesomeIcon icon={faCheck} /> {t("signInProviders.secretSet")}</span>
              <button type="button" className="btn-ghost btn-sm" disabled={patch.isPending} onClick={() => patch.mutate({ clientSecret: null })}>
                {t("signInProviders.remove")}
              </button>
            </div>
          ) : (
            <div className="sp-inline">
              <input className="inp" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} />
              <button type="button" className="btn-primary btn-sm" disabled={!secret.trim() || patch.isPending}
                onClick={() => patch.mutate({ clientSecret: secret.trim() }, { onSuccess: () => setSecret("") })}>
                {t("signInProviders.set")}
              </button>
            </div>
          )}
        </div>
        <div className="sp-field sp-field--full">
          <span className="set-row__label">{t("signInProviders.callback")}</span>
          <div className="sp-inline">
            <code className="sp-code">{row.callbackUrl}</code>
            <button type="button" className="btn-ghost btn-sm" onClick={copy}>
              <FontAwesomeIcon icon={copied ? faCheck : faCopy} /> {copied ? t("signInProviders.copied") : t("signInProviders.copy")}
            </button>
          </div>
          <span className="set-row__desc">
            {t("signInProviders.callbackHint")}{" "}
            <a href={meta.console} target="_blank" rel="noopener noreferrer">{t("signInProviders.console", { name: meta.name })}</a>
          </span>
        </div>
      </div>
    </div>
  );
}

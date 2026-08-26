import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { swalToast, apiErrorMessage } from "../../../lib/swal";
import { useAutosave, sameValue } from "../../../hooks/useAutosave";
import { AutosaveStatus } from "../../../components/AutosaveStatus";

interface Setting { key: string; value: unknown }

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <div onClick={onToggle} style={{ width:40,height:22,background:on?"var(--c-accent)":"var(--c-border)",borderRadius:100,cursor:"pointer",position:"relative",flexShrink:0,transition:"background 0.2s" }}>
      <div style={{ width:16,height:16,background:"var(--c-on-accent)",borderRadius:"50%",position:"absolute",top:3,left:on?21:3,transition:"left 0.2s" }} />
    </div>
  );
}

// Map settings keys → local state
function parse(settings: Setting[]): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (const s of settings) map[s.key] = s.value;
  return map;
}

/** Form field → the settings key it persists to. One list, so the save path and
 *  the seed path cannot drift apart. */
const SETTING_KEY: Record<string, string> = {
  expiryEnabled:  "moderation.warning_expiry_enabled",
  expiryDays:     "moderation.warning_expiry_days",
  allowOverride:  "moderation.ban_allow_override",
  appealEnabled:  "moderation.ban_appeals_enabled",
  resetCount:     "moderation.reset_count_after_ban",
  defaultBanDays: "moderation.default_ban_days",
  minDays:        "moderation.min_ban_days",
  maxDays:        "moderation.max_ban_days",
  patRapid:       "security.pattern.rapid_login_attempts",
  patMulti:       "security.pattern.multi_account_suspicion",
  patRegBurst:    "security.pattern.registration_burst",
  patBanEvasion:  "security.pattern.ban_evasion_suspicion",
};

export function ModSettingsPage() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();

  const { data: settings = [] } = useQuery<Setting[]>({
    queryKey: ["acp-settings"],
    queryFn: () => api.get("/admin/settings"),
  });

  const saveMutation = useMutation({
    mutationFn: (entries: Array<[string, unknown]>) =>
      Promise.all(entries.map(([key, value]) =>
        api.put(`/admin/settings/${encodeURIComponent(key)}`, { value }))),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["acp-settings"] });
      swalToast(t("modSettings.toastSaved"), "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const raw = parse(settings);

  // Local draft state
  const [expiryEnabled,  setExpiryEnabled]  = useState(true);
  const [expiryDays,     setExpiryDays]     = useState(90);
  const [allowOverride,  setAllowOverride]  = useState(true);
  const [appealEnabled,  setAppealEnabled]  = useState(false);
  const [resetCount,     setResetCount]     = useState(false);
  const [defaultBanDays, setDefaultBanDays] = useState(7);
  const [minDays,        setMinDays]        = useState(1);
  const [maxDays,        setMaxDays]        = useState(365);
  const [patRapid,       setPatRapid]       = useState(true);
  const [patMulti,       setPatMulti]       = useState(true);
  const [patRegBurst,    setPatRegBurst]    = useState(true);
  const [patBanEvasion,  setPatBanEvasion]  = useState(true);

  const setField = {
    expiryEnabled:  setExpiryEnabled,
    expiryDays:     setExpiryDays,
    allowOverride:  setAllowOverride,
    appealEnabled:  setAppealEnabled,
    resetCount:     setResetCount,
    defaultBanDays: setDefaultBanDays,
    minDays:        setMinDays,
    maxDays:        setMaxDays,
    patRapid:       setPatRapid,
    patMulti:       setPatMulti,
    patRegBurst:    setPatRegBurst,
    patBanEvasion:  setPatBanEvasion,
  } as Record<string, (v: never) => void>;



  // Draft (current form) vs the server's persisted values, using identical
  // defaults to the merge below so a freshly-loaded form never auto-saves.
  const draft = { expiryEnabled, expiryDays, allowOverride, appealEnabled, resetCount, defaultBanDays, minDays, maxDays, patRapid, patMulti, patRegBurst, patBanEvasion };
  const savedValue = settings.length ? {
    expiryEnabled:  raw["moderation.warning_expiry_enabled"] as boolean ?? true,
    expiryDays:     raw["moderation.warning_expiry_days"]    as number  ?? 90,
    allowOverride:  raw["moderation.ban_allow_override"]     as boolean ?? true,
    appealEnabled:  raw["moderation.ban_appeals_enabled"]    as boolean ?? false,
    resetCount:     raw["moderation.reset_count_after_ban"]  as boolean ?? false,
    defaultBanDays: raw["moderation.default_ban_days"]       as number  ?? 7,
    minDays:        raw["moderation.min_ban_days"]           as number  ?? 1,
    maxDays:        raw["moderation.max_ban_days"]           as number  ?? 365,
    patRapid:       raw["security.pattern.rapid_login_attempts"]    as boolean ?? true,
    patMulti:       raw["security.pattern.multi_account_suspicion"] as boolean ?? true,
    patRegBurst:    raw["security.pattern.registration_burst"]      as boolean ?? true,
    patBanEvasion:  raw["security.pattern.ban_evasion_suspicion"]   as boolean ?? true,
  } : undefined;

  /** The last server snapshot this page merged — see the effect below. */
  const serverRef = useRef<Record<string, unknown> | null>(null);

  /**
   * Merge each new server snapshot into the form, per field.
   *
   * This seeded on `[settings.length]`, which re-ran only if the NUMBER of
   * settings rows changed — so a tab left open while somebody edited the same
   * settings elsewhere kept its stale form, while `savedValue` (derived every
   * render) went fresh. Autosave then saw form ≠ saved and wrote the whole
   * stale form back, reverting the other session's changes.
   *
   * A field nobody has touched here follows the server; a field with an unsaved
   * local edit keeps it, because autosave is about to push it.
   */
  useEffect(() => {
    if (!settings.length || !savedValue) return;
    const prevServer = serverRef.current;
    serverRef.current = savedValue as Record<string, unknown>;
    for (const [key, incoming] of Object.entries(savedValue)) {
      if (prevServer) {
        if (sameValue(incoming, prevServer[key])) continue;                        // unchanged on the server
        if (!sameValue((draft as Record<string, unknown>)[key], prevServer[key])) continue; // unsaved local edit
      }
      setField[key]?.(incoming as never);
    }
    // `settings` is structurally shared by the query client, so this runs when
    // the DATA changes, not on every refetch returning the same rows. `draft` is
    // deliberately not a dependency — it changes on every keystroke, and this
    // must only react to the server.
  }, [settings]);

  // Only the fields that changed are written — a save must not stamp the whole
  // form over whatever the server holds. See the merge effect above.
  useAutosave({
    value: draft,
    savedValue,
    onSave: (d) => {
      const saved = savedValue as Record<string, unknown> | undefined;
      const changed = Object.entries(d)
        .filter(([field, value]) => !sameValue(value, saved?.[field]))
        .map(([field, value]) => [SETTING_KEY[field]!, value] as [string, unknown]);
      if (changed.length) saveMutation.mutate(changed);
    },
  });

  return (
    <div>
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">{t("modSettings.sub")}</div>
          <h1 className="acp-page-title">{t("modSettings.title")}</h1>
        </div>
        <AutosaveStatus saving={saveMutation.isPending} />
      </div>

      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:20 }}>
        {/* Warning policy */}
        <div className="acp-card" style={{ padding:"24px" }}>
          <div style={{ fontSize:16,fontWeight:800,color:"var(--c-fg)",marginBottom:20 }}>{t("modSettings.warningPolicy")}</div>

          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 0",borderBottom:"1px solid var(--c-border)",marginBottom:16 }}>
            <div>
              <div style={{ fontSize:14,fontWeight:600,color:"var(--c-fg)" }}>{t("modSettings.warningExpiry")}</div>
              <div style={{ fontSize:12,color:"var(--c-fg-muted)" }}>{t("modSettings.warningExpiryDesc")}</div>
            </div>
            <Toggle on={expiryEnabled} onToggle={() => setExpiryEnabled(v => !v)} />
          </div>

          {expiryEnabled && (
            <div className="acp-form-field">
              <label className="acp-label">{t("modSettings.expireAfter")}</label>
              <input type="number" className="acp-input" value={expiryDays} onChange={e => setExpiryDays(+e.target.value)} />
            </div>
          )}

          <div style={{ fontSize:13,fontWeight:700,color:"var(--c-fg)",marginBottom:10,marginTop:16 }}>{t("modSettings.thresholds")}</div>
          {[{ count:3,action:"Temp ban",days:"7" },{ count:5,action:"Perm ban",days:null }].map((th, i) => (
            <div key={i} style={{ background:"var(--c-surface)",border:"1px solid var(--c-border)",borderRadius:"var(--radius-sm)",padding:"14px",marginBottom:10 }}>
              <div style={{ display:"grid",gridTemplateColumns:th.days?"80px 1fr 80px":"80px 1fr",gap:8,marginBottom:8 }}>
                <div><div style={{ fontSize:11,color:"var(--c-fg-muted)",marginBottom:4 }}>{t("modSettings.afterWarns")}</div><input type="number" className="acp-input" defaultValue={th.count} /></div>
                <div><div style={{ fontSize:11,color:"var(--c-fg-muted)",marginBottom:4 }}>{t("modSettings.action")}</div><select className="acp-select" style={{ width:"100%" }}><option>{t("modSettings.actTempBan")}</option><option>{t("modSettings.actPermBan")}</option><option>{t("modSettings.actNotify")}</option></select></div>
                {th.days && <div><div style={{ fontSize:11,color:"var(--c-fg-muted)",marginBottom:4 }}>{t("modSettings.days")}</div><input type="number" className="acp-input" defaultValue={th.days} /></div>}
              </div>
              <div style={{ display:"flex",alignItems:"center",gap:8 }}><input type="checkbox" defaultChecked style={{ accentColor:"var(--c-accent)" }} /><span style={{ fontSize:12,color:"var(--c-fg-muted)" }}>{t("modSettings.notifyModerators")}</span></div>
            </div>
          ))}
          <button type="button" className="btn-ghost btn-sm"><FontAwesomeIcon icon={faPlus} style={{ marginRight:5 }} /> {t("modSettings.addThreshold")}</button>
        </div>

        {/* Ban policy */}
        <div className="acp-card" style={{ padding:"24px" }}>
          <div style={{ fontSize:16,fontWeight:800,color:"var(--c-fg)",marginBottom:20 }}>{t("modSettings.banPolicy")}</div>
          {([[t("modSettings.defaultBanDuration"), defaultBanDays, setDefaultBanDays],[t("modSettings.minDuration"), minDays, setMinDays],[t("modSettings.maxDuration"), maxDays, setMaxDays]] as [string, number, (v: number) => void][]).map(([label, val, setter]) => (
            <div key={label} className="acp-form-field">
              <label className="acp-label">{label}</label>
              <input type="number" className="acp-input" value={val} onChange={e => setter(+e.target.value)} />
            </div>
          ))}
          {([[t("modSettings.allowOverride"), allowOverride, setAllowOverride],[t("modSettings.allowAppeals"), appealEnabled, setAppealEnabled],[t("modSettings.resetAfterBan"), resetCount, setResetCount]] as [string, boolean, (v: boolean) => void][]).map(([label, val, setter]) => (
            <div key={label} style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 0",borderTop:"1px solid var(--c-border)" }}>
              <div style={{ fontSize:14,fontWeight:600,color:"var(--c-fg)" }}>{label}</div>
              <Toggle on={val} onToggle={() => setter(!val)} />
            </div>
          ))}
        </div>

        {/* §15 baseline detection patterns */}
        <div className="acp-card" style={{ padding:"24px", gridColumn:"1 / -1" }}>
          <div style={{ fontSize:16,fontWeight:800,color:"var(--c-fg)",marginBottom:4 }}>{t("modSettings.detectionPatterns")}</div>
          <div style={{ fontSize:12,color:"var(--c-fg-muted)",marginBottom:12 }}>{t("modSettings.detectionPatternsDesc")}</div>
          {([
            [t("modSettings.patRapidLogin"),  t("modSettings.patRapidLoginDesc"),  patRapid,      setPatRapid],
            [t("modSettings.patMulti"),       t("modSettings.patMultiDesc"),       patMulti,      setPatMulti],
            [t("modSettings.patRegBurst"),    t("modSettings.patRegBurstDesc"),    patRegBurst,   setPatRegBurst],
            [t("modSettings.patBanEvasion"),  t("modSettings.patBanEvasionDesc"),  patBanEvasion, setPatBanEvasion],
          ] as [string, string, boolean, (v: boolean) => void][]).map(([label, desc, val, setter]) => (
            <div key={label} style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 0",borderTop:"1px solid var(--c-border)" }}>
              <div>
                <div style={{ fontSize:14,fontWeight:600,color:"var(--c-fg)" }}>{label}</div>
                <div style={{ fontSize:12,color:"var(--c-fg-muted)" }}>{desc}</div>
              </div>
              <Toggle on={val} onToggle={() => setter(!val)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

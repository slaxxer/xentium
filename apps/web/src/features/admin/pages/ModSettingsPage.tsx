import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { swalToast, apiErrorMessage } from "../../../lib/swal";
import { useAutosave } from "../../../hooks/useAutosave";
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

  // Seed from Settings API on first load
  useEffect(() => {
    if (!settings.length) return;
    setExpiryEnabled( raw["moderation.warning_expiry_enabled"]  as boolean ?? true);
    setExpiryDays(    raw["moderation.warning_expiry_days"]     as number  ?? 90);
    setAllowOverride( raw["moderation.ban_allow_override"]      as boolean ?? true);
    setAppealEnabled( raw["moderation.ban_appeals_enabled"]     as boolean ?? false);
    setResetCount(    raw["moderation.reset_count_after_ban"]   as boolean ?? false);
    setDefaultBanDays(raw["moderation.default_ban_days"]        as number  ?? 7);
    setMinDays(       raw["moderation.min_ban_days"]            as number  ?? 1);
    setMaxDays(       raw["moderation.max_ban_days"]            as number  ?? 365);
    setPatRapid(      raw["security.pattern.rapid_login_attempts"]    as boolean ?? true);
    setPatMulti(      raw["security.pattern.multi_account_suspicion"] as boolean ?? true);
    setPatRegBurst(   raw["security.pattern.registration_burst"]      as boolean ?? true);
    setPatBanEvasion( raw["security.pattern.ban_evasion_suspicion"]   as boolean ?? true);
  }, [settings.length]);

  function entriesOf(s: {
    expiryEnabled: boolean; expiryDays: number; allowOverride: boolean; appealEnabled: boolean;
    resetCount: boolean; defaultBanDays: number; minDays: number; maxDays: number;
    patRapid: boolean; patMulti: boolean; patRegBurst: boolean; patBanEvasion: boolean;
  }): Array<[string, unknown]> {
    return [
      ["moderation.warning_expiry_enabled",  s.expiryEnabled],
      ["moderation.warning_expiry_days",     s.expiryDays],
      ["moderation.ban_allow_override",      s.allowOverride],
      ["moderation.ban_appeals_enabled",     s.appealEnabled],
      ["moderation.reset_count_after_ban",   s.resetCount],
      ["moderation.default_ban_days",        s.defaultBanDays],
      ["moderation.min_ban_days",            s.minDays],
      ["moderation.max_ban_days",            s.maxDays],
      ["security.pattern.rapid_login_attempts",    s.patRapid],
      ["security.pattern.multi_account_suspicion", s.patMulti],
      ["security.pattern.registration_burst",      s.patRegBurst],
      ["security.pattern.ban_evasion_suspicion",   s.patBanEvasion],
    ];
  }

  // Draft (current form) vs the server's persisted values, using identical
  // defaults to the seeding above so a freshly-loaded form never auto-saves.
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

  useAutosave({ value: draft, savedValue, onSave: (d) => saveMutation.mutate(entriesOf(d)) });

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

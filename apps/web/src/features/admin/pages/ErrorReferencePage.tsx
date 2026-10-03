import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "../../../components/Icon";
import { faMagnifyingGlass, faCircleInfo } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { Badge } from "../../../components/Badge";

interface XecEntry {
  msg:    string;
  desc:   string;
  cause:  string;
  fix:    string;
  sev:    "Error" | "Warning" | "Info" | "Critical";
  domain: string;
}

/**
 * Structural metadata for each core XEC code: severity (drives the badge colour)
 * and domain (drives filtering). The human-readable text — msg/desc/cause/fix —
 * lives in the `acp` locale bundle under `errorRef.codes.<CODE>` and is resolved
 * per language at render time (see `coreCatalog` below). Plugin-registered codes
 * arrive fully-formed from the server and are merged in as-is.
 */
const META: Record<string, { sev: XecEntry["sev"]; domain: string }> = {
  // API
  "XEC-API-4001": { sev:"Warning", domain:"API" },
  "XEC-API-4003": { sev:"Warning", domain:"API" },
  "XEC-API-4004": { sev:"Info", domain:"API" },
  "XEC-API-4009": { sev:"Warning", domain:"API" },
  "XEC-API-4290": { sev:"Warning", domain:"API" },
  "XEC-API-5000": { sev:"Error", domain:"API" },
  // Auth
  "XEC-AUTH-1001": { sev:"Warning", domain:"Auth" },
  "XEC-AUTH-1002": { sev:"Info", domain:"Auth" },
  "XEC-AUTH-1003": { sev:"Warning", domain:"Auth" },
  "XEC-AUTH-1004": { sev:"Error", domain:"Auth" },
  "XEC-AUTH-1005": { sev:"Warning", domain:"Auth" },
  "XEC-AUTH-1006": { sev:"Warning", domain:"Auth" },
  "XEC-AUTH-2001": { sev:"Warning", domain:"Auth" },
  "XEC-AUTH-2002": { sev:"Warning", domain:"Auth" },
  "XEC-AUTH-2003": { sev:"Warning", domain:"Auth" },
  "XEC-AUTH-1007": { sev:"Warning", domain:"Auth" },
  // Permissions
  "XEC-PERM-1001": { sev:"Warning", domain:"Permissions" },
  "XEC-PERM-1040": { sev:"Warning", domain:"Permissions" },
  "XEC-PERM-1041": { sev:"Warning", domain:"Permissions" },
  "XEC-PERM-1042": { sev:"Warning", domain:"Permissions" },
  // Articles
  "XEC-ARTICLE-3001": { sev:"Info", domain:"Articles" },
  "XEC-ARTICLE-3002": { sev:"Info", domain:"Articles" },
  "XEC-ARTICLE-3003": { sev:"Warning", domain:"Articles" },
  // Storage
  "XEC-STORE-7001": { sev:"Warning", domain:"Storage" },
  "XEC-STORE-7002": { sev:"Warning", domain:"Storage" },
  "XEC-STORE-7003": { sev:"Warning", domain:"Storage" },
  "XEC-STORE-7004": { sev:"Error", domain:"Storage" },
  // Plugin
  "XEC-PLUGIN-2001": { sev:"Error", domain:"Plugin Engine" },
  "XEC-PLUGIN-2002": { sev:"Error", domain:"Plugin Engine" },
  "XEC-PLUGIN-2003": { sev:"Warning", domain:"Plugin Engine" },
  "XEC-PLUGIN-2004": { sev:"Warning", domain:"Plugin Engine" },
  "XEC-PLUGIN-2005": { sev:"Warning", domain:"Plugin Engine" },
  "XEC-PLUGIN-2006": { sev:"Info", domain:"Plugin Engine" },
  "XEC-PLUGIN-2010": { sev:"Error", domain:"Plugin Engine" },
  "XEC-PLUGIN-2011": { sev:"Error", domain:"Plugin Engine" },
  "XEC-PLUGIN-2012": { sev:"Error", domain:"Plugin Engine" },
  "XEC-PLUGIN-2013": { sev:"Error", domain:"Plugin Engine" },
  "XEC-PLUGIN-2020": { sev:"Info", domain:"Plugin Engine" },
  "XEC-PLUGIN-2030": { sev:"Error", domain:"Plugin Engine" },
  // Core
  "XEC-CORE-8001": { sev:"Error", domain:"Core" },
  "XEC-CORE-8002": { sev:"Warning", domain:"Core" },
  "XEC-CORE-8010": { sev:"Info", domain:"Core" },
  // Legal documents
  "XEC-LEGAL-3501": { sev:"Info", domain:"Legal" },
  "XEC-LEGAL-3502": { sev:"Warning", domain:"Legal" },
  // Queue / background jobs
  "XEC-QUEUE-5000": { sev:"Error", domain:"Queue" },
  "XEC-QUEUE-5001": { sev:"Warning", domain:"Queue" },
  // License / Marketplace
  "XEC-LICENSE-9001": { sev:"Warning", domain:"License" },
  "XEC-LICENSE-9002": { sev:"Warning", domain:"License" },
  "XEC-LICENSE-9003": { sev:"Warning", domain:"License" },
  "XEC-LICENSE-9004": { sev:"Warning", domain:"License" },
  "XEC-LICENSE-9005": { sev:"Info", domain:"License" },
  "XEC-LICENSE-9006": { sev:"Error", domain:"License" },
  "XEC-LICENSE-9007": { sev:"Warning", domain:"License" },
  "XEC-LICENSE-9008": { sev:"Warning", domain:"License" },
  "XEC-LICENSE-9009": { sev:"Warning", domain:"License" },
};

const CORE_DOMAINS = ["API", "Auth", "Permissions", "Articles", "Page", "Storage", "Plugin Engine", "Core", "Queue", "License"];

const SEV_COLOR: Record<string, string> = {
  Critical: "var(--c-danger)",
  Error:    "var(--c-danger)",
  Warning:  "var(--c-warn)",
  Info:     "var(--c-accent)",
};

export function ErrorReferencePage() {
  const { t } = useTranslation("acp");
  const [code,     setCode]     = useState("");
  const [filter,   setFilter]   = useState("");
  const [domain,   setDomain]   = useState("");
  const [result,   setResult]   = useState<(XecEntry & { code: string }) | { notfound: true; code: string } | null>(null);

  // Fetch plugin-registered XEC codes
  const { data: rawPluginCodes } = useQuery<Record<string, XecEntry>[]>({
    queryKey: ["admin-xec-codes"],
    queryFn:  () => api.get<Record<string, XecEntry>[]>("/admin/xec-codes").catch(() => [] as Record<string, XecEntry>[]),
    staleTime: 300_000,
  });
  const pluginCodes = (rawPluginCodes ?? []) as unknown as Array<XecEntry & { code: string }>;

  // Localized display for a severity / domain (plugin-provided values fall back
  // to their raw string when the bundle has no key for them).
  const sevLabel    = (s: string) => t(`errorRef.sev.${s}`,     { defaultValue: s });
  const domainLabel = (d: string) => t(`errorRef.domains.${d}`, { defaultValue: d });

  // Core catalog: structural META + per-language text from the acp bundle.
  const coreCatalog: Record<string, XecEntry> = Object.fromEntries(
    Object.entries(META).map(([code, m]) => [code, {
      sev:    m.sev,
      domain: m.domain,
      msg:    t(`errorRef.codes.${code}.msg`),
      desc:   t(`errorRef.codes.${code}.desc`),
      cause:  t(`errorRef.codes.${code}.cause`),
      fix:    t(`errorRef.codes.${code}.fix`),
    }]),
  );

  // Merge plugin codes into catalog for lookup and filtering
  const fullCatalog: Record<string, XecEntry> = {
    ...coreCatalog,
    ...Object.fromEntries(pluginCodes.map((c) => [c.code, c])),
  };
  const pluginDomains = [...new Set(pluginCodes.map((c) => c.domain))];
  const DOMAINS = [...CORE_DOMAINS, ...pluginDomains];

  function lookup(c = code) {
    const key = c.toUpperCase().trim();
    const r   = fullCatalog[key];
    setResult(r ? { ...r, code: key } : { notfound: true, code: key });
  }

  // Deep-link support: the fatal-error overlay sends the admin here with ?code=XEC-...
  // Auto-fill + auto-lookup once the (plugin-augmented) catalog is ready.
  const [searchParams] = useSearchParams();
  const paramCode = searchParams.get("code");
  useEffect(() => {
    if (!paramCode) return;
    const key = paramCode.toUpperCase().trim();
    setCode(key);
    setResult(fullCatalog[key] ? { ...fullCatalog[key], code: key } : { notfound: true, code: key });
  }, [paramCode, rawPluginCodes]);

  const filtered = Object.entries(fullCatalog).filter(([k, v]) => {
    const q = filter.toLowerCase();
    const domMatch = !domain || v.domain === domain;
    const textMatch = !q || k.toLowerCase().includes(q) || v.msg.toLowerCase().includes(q)
      || v.domain.toLowerCase().includes(q) || domainLabel(v.domain).toLowerCase().includes(q);
    return domMatch && textMatch;
  });

  return (
    <div style={{ maxWidth: 860 }}>
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">{t("nav.system")}</div>
          <h1 className="acp-page-title">{t("errorRef.title")}</h1>
        </div>
      </div>

      {/* Lookup */}
      <div className="acp-card" style={{ padding: 24, marginBottom: 20 }}>
        <div style={{ fontSize: "var(--fs-md)", fontWeight: 700, color: "var(--c-fg)", marginBottom: 10 }}>{t("errorRef.lookupTitle")}</div>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            className="acp-input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t("errorRef.lookupPlaceholder")}
            style={{ fontFamily: "monospace", letterSpacing: "0.05em", flex: 1 }}
            onKeyDown={(e) => e.key === "Enter" && lookup()}
          />
          <button type="button" className="btn-primary btn-sm" onClick={() => lookup()}>
            <FontAwesomeIcon icon={faMagnifyingGlass} style={{ marginRight: 5 }} /> {t("errorRef.lookupBtn")}
          </button>
        </div>
      </div>

      {/* Result */}
      {result && (
        "notfound" in result ? (
          <div className="acp-card" style={{ padding: 24, textAlign: "center", marginBottom: 20 }}>
            <FontAwesomeIcon icon={faMagnifyingGlass} style={{ fontSize: "1.75rem", color: "var(--c-fg-muted)", marginBottom: 8 }} />
            <div style={{ fontSize: "var(--fs-base)", fontWeight: 700, color: "var(--c-fg)" }}>{t("errorRef.notFoundTitle")}</div>
            <div style={{ fontSize: "var(--fs-sm)", color: "var(--c-fg-muted)", marginTop: 4 }}>{t("errorRef.notFoundBody", { code: result.code })}</div>
          </div>
        ) : (
          <div className="acp-card" style={{ padding: 24, marginBottom: 20, borderLeft: `3px solid ${SEV_COLOR[result.sev]}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
              <span style={{ fontFamily: "monospace", fontSize: "var(--fs-sm)", fontWeight: 800, color: "var(--c-accent)", background: "var(--c-accent-soft)", border: "1px solid var(--c-accent-glow)", padding: "5px 12px", borderRadius: "var(--radius-sm)" }}>
                {result.code}
              </span>
              <Badge label={sevLabel(result.sev)} color={SEV_COLOR[result.sev]} />
              <Badge label={domainLabel(result.domain)} />
            </div>
            <div style={{ fontSize: "1.0625rem", fontWeight: 800, color: "var(--c-fg)", marginBottom: 20 }}>{result.msg}</div>
            {([[t("errorRef.whatHappened"), result.desc], [t("errorRef.likelyCause"), result.cause], [t("errorRef.suggestedFix"), result.fix]] as [string, string][]).map(([label, val]) => (
              <div key={label} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: "var(--fs-2xs)", fontWeight: 700, color: "var(--c-fg-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 5 }}>{label}</div>
                <div style={{ fontSize: "var(--fs-md)", color: "var(--c-fg-muted)", lineHeight: 1.7 }}>{val}</div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Catalog browser */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <input
          className="acp-input"
          placeholder={t("errorRef.filterPlaceholder")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1 }}
        />
        <select className="acp-select" style={{ width: "auto" }} value={domain} onChange={(e) => setDomain(e.target.value)}>
          <option value="">{t("errorRef.allDomains")}</option>
          {DOMAINS.map((d) => <option key={d} value={d}>{domainLabel(d)}</option>)}
        </select>
      </div>

      <div className="acp-card" style={{ padding: 0, overflow: "hidden" }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center" }}>
            <FontAwesomeIcon icon={faCircleInfo} style={{ fontSize: "var(--fs-2xl)", color: "var(--c-fg-muted)", marginBottom: 8 }} />
            <div style={{ fontSize: "var(--fs-sm)", color: "var(--c-fg-muted)" }}>{t("errorRef.noMatch")}</div>
          </div>
        ) : filtered.map(([k, v], i) => (
          <div
            key={k}
            onClick={() => { setCode(k); lookup(k); window.scrollTo({ top: 0, behavior: "smooth" }); }}
            style={{ display: "grid", gridTemplateColumns: "180px 1fr 100px 90px", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: i < filtered.length - 1 ? "1px solid var(--c-border)" : "none", cursor: "pointer", transition: "background 0.12s" }}
            onMouseEnter={(e) => e.currentTarget.style.background = "var(--c-accent-soft)"}
            onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
          >
            <div style={{ fontFamily: "monospace", fontSize: "var(--fs-xs)", fontWeight: 700, color: "var(--c-accent)" }}>{k}</div>
            <div style={{ fontSize: "var(--fs-sm)", color: "var(--c-fg)" }}>{v.msg}</div>
            <div style={{ fontSize: "var(--fs-2xs)", color: "var(--c-fg-muted)" }}>{domainLabel(v.domain)}</div>
            <Badge label={sevLabel(v.sev)} color={SEV_COLOR[v.sev]} />
          </div>
        ))}
      </div>
      <div style={{ fontSize: "var(--fs-xs)", color: "var(--c-fg-muted)", marginTop: 10, textAlign: "right" }}>
        {t("errorRef.countSummary", { shown: filtered.length, total: Object.keys(fullCatalog).length })}
      </div>
    </div>
  );
}

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { faChevronDown, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../../../components/Icon";
import { groupByDomain, type Permission } from "../../../../lib/permissions";
import { isSensitive, powerOf } from "./groupModel";
import { PowerMeter } from "./groupParts";
import { impliedBy } from "../permissions/permissionsModel";
import { permissionDomainLabel } from "../../../../lib/coreText";

export function PermissionsTab({ allPermissions, keys, onChange }: {
  allPermissions: Permission[];
  /** What the group holds, from the server (optimistically updated). */
  keys: string[];
  /** Grant/revoke exactly these keys — never a whole replacement set. */
  onChange: (delta: { grant: string[]; revoke: string[] }) => void;
}) {
  const { t } = useTranslation("acp");
  const domains = groupByDomain(allPermissions);
  const held = new Set(keys);
  // Every domain starts closed, as on the Permissions page: one line each with its
  // count and sensitive marker, and the admin opens the one they came for.
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const heldDomains = domains.filter(([, ps]) => ps.some((p) => held.has(p.key))).length;

  const toggleKey = (key: string) => onChange(held.has(key) ? { grant: [], revoke: [key] } : { grant: [key], revoke: [] });
  const setDomain = (perms: Permission[], on: boolean) => {
    const keysIn = perms.map((p) => p.key);
    onChange(on ? { grant: keysIn.filter((k) => !held.has(k)), revoke: [] } : { grant: [], revoke: keysIn.filter((k) => held.has(k)) });
  };

  return (
    <section className="gp-card">
      <div className="gp-perm-head">
        <div>
          <h2 className="gp-section">{t("groups.perms.title")}</h2>
          <p className="gp-hint">{t("groups.perms.summary", { count: keys.length, domains: heldDomains })}</p>
        </div>
        <PowerMeter power={powerOf(keys)} />
      </div>

      {domains.length === 0 && <div className="gp-empty">{t("groups.perms.none")}</div>}

      {domains.map(([domain, perms]) => {
        const on = perms.filter((p) => held.has(p.key)).length;
        const isOpen = open.has(domain);
        const hot = perms.some((p) => held.has(p.key) && isSensitive(p.key));
        return (
          <div key={domain} className="gp-domain">
            <div className="gp-domain__head">
              <button type="button" className="gp-domain__toggle" aria-expanded={isOpen}
                onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(domain)) n.delete(domain); else n.add(domain); return n; })}>
                <FontAwesomeIcon icon={faChevronDown} className={`gp-chev${isOpen ? "" : " is-closed"}`} />
                <span className="gp-domain__name">{permissionDomainLabel(domain)}</span>
                {hot && <span className="gp-sensitive"><FontAwesomeIcon icon={faTriangleExclamation} /> {t("groups.perms.sensitive")}</span>}
              </button>
              <button type="button" className="gp-domain__all" onClick={() => setDomain(perms, on < perms.length)}>
                {on < perms.length ? t("groups.perms.grantAll") : t("groups.perms.revokeAll")}
              </button>
              <span className="gp-fill" aria-hidden><span style={{ width: `${Math.round((on / perms.length) * 100)}%` }} /></span>
              <span className="gp-domain__count">{on}/{perms.length}</span>
            </div>
            {isOpen && (
              <div className="gp-perms">
                {perms.map((p) => {
                  // Carried by a stronger key the group holds: shown held, not editable.
                  const via = impliedBy(held, p.key);
                  return (
                  <label key={p.key} className={`gp-perm${held.has(p.key) || via ? " is-on" : ""}${via ? " is-implied" : ""}`}
                    title={via ? t("permissions.impliedHint", { key: via }) : undefined}>
                    <input type="checkbox" checked={held.has(p.key) || !!via} disabled={!!via} onChange={() => toggleKey(p.key)} />
                    <span className="gp-perm__label">{p.label}</span>
                    {via && <span className="gp-perm__via">{t("permissions.impliedBy", { key: via })}</span>}
                    {isSensitive(p.key) && <span className="gp-sensitive gp-sensitive--sm">{t("groups.perms.sensitive")}</span>}
                    <code className="gp-perm__key">{p.key}</code>
                  </label>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

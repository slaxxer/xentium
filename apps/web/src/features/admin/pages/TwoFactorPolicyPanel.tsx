import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { faShieldHalved, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { CorePermissions } from "@xentium/contracts";
import { FontAwesomeIcon } from "../../../components/Icon";
import { Toggle } from "../../../components/AcpControls";
import { useDraft } from "../../../hooks/useDraft";
import { useAuth } from "../../../hooks/useAuth";
import { api } from "../../../lib/api";
import { DEFAULT_BADGE_COLOR } from "./groups/groupModel";

// ACP → Settings → Login: which groups MUST use two-factor sign-in.
//
// It is the `account.twofactor.required` permission, shown where an admin looks
// for it; ACP → Permissions edits the same grants. Members of a ticked group are
// asked to turn it on on every page, and the ACP stays closed to them until they do.

const DUTY = CorePermissions.ACCOUNT_TWO_FACTOR_REQUIRED;

interface GroupRow {
  id: string;
  key: string | null;
  name: string;
  progression: { badgeColor: string | null } | null;
  _count: { users: number };
  permissions: { permission: { key: string } }[];
}

type Duty = Record<string, boolean>;

const dutyOf = (groups: GroupRow[]): Duty =>
  Object.fromEntries(groups.map((g) => [g.id, g.permissions.some((p) => p.permission.key === DUTY)]));

export function TwoFactorPolicyPanel() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const { data: groups } = useQuery<GroupRow[]>({ queryKey: ["acp-groups-2fa"], queryFn: () => api.get("/admin/groups") });

  const saved = groups ? dutyOf(groups) : undefined;
  const [draft, setDraft] = useState<Duty>({});
  useEffect(() => { if (groups) setDraft(dutyOf(groups)); }, [groups]);

  useDraft<Duty>({
    value: draft,
    savedValue: saved,
    label: t("twoFactorPolicy.title"),
    section: t("settings.sections.login.title"),
    describe: (v, s) => (groups ?? []).filter((g) => v[g.id] !== s[g.id]).map((g) => ({
      key: g.id,
      label: g.name,
      revert: () => setDraft((d) => ({ ...d, [g.id]: !!s[g.id] })),
      from: s[g.id] ? t("twoFactorPolicy.required") : t("twoFactorPolicy.optional"),
      to: v[g.id] ? t("twoFactorPolicy.required") : t("twoFactorPolicy.optional"),
    })),
    onSave: async (v) => {
      const changed = (groups ?? []).filter((g) => v[g.id] !== saved?.[g.id]);
      // One at a time: the first one asks for the code, the rest ride on that step-up.
      for (const g of changed) {
        await api.patch(`/admin/groups/${g.id}/permissions`, v[g.id] ? { grant: [DUTY], revoke: [] } : { grant: [], revoke: [DUTY] });
      }
      await qc.invalidateQueries({ queryKey: ["acp-groups-2fa"] });
      await qc.invalidateQueries({ queryKey: ["auth", "me"] });
    },
    onDiscard: () => { if (groups) setDraft(dutyOf(groups)); },
  });

  if (!groups) return null;

  // Saving would close the ACP to the admin doing it: say so before they press Save.
  const myGroups = new Set((me?.groups ?? []).map((g) => g.id));
  const locksMeOut = !me?.twoFactor?.enabled && groups.some((g) => myGroups.has(g.id) && draft[g.id] && !saved?.[g.id]);

  return (
    <div className="sp-card tfp">
      <div className="sp-card__head">
        <span className="sp-card__icon"><FontAwesomeIcon icon={faShieldHalved} /></span>
        <div className="sp-card__titles">
          <strong>{t("twoFactorPolicy.title")}</strong>
          <span className="set-row__desc">{t("twoFactorPolicy.desc")}</span>
        </div>
      </div>
      <div className="tfp__rows">
        {groups.map((g) => (
          <div className="tfp__row" key={g.id}>
            <span className="tfp__dot" style={{ background: g.progression?.badgeColor || DEFAULT_BADGE_COLOR }} />
            <div className="tfp__name">
              <span className="set-row__label">{g.name}</span>
              <span className="set-row__desc">{t("twoFactorPolicy.members", { count: g._count.users })}</span>
            </div>
            <span className="tfp__state">{draft[g.id] ? t("twoFactorPolicy.required") : t("twoFactorPolicy.optional")}</span>
            <Toggle
              on={!!draft[g.id]}
              label={t("twoFactorPolicy.toggle", { group: g.name })}
              onToggle={() => setDraft((d) => ({ ...d, [g.id]: !d[g.id] }))}
            />
          </div>
        ))}
      </div>
      {locksMeOut && (
        <p className="tfp__warn">
          <FontAwesomeIcon icon={faTriangleExclamation} /> {t("twoFactorPolicy.lockoutWarning")}
        </p>
      )}
    </div>
  );
}

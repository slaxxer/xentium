/**
 * The warning picker: a warn dialog's ONLY input.
 *
 * A moderator warns by picking one of the site's warning templates (ACP → Moderation
 * → Templates, `mode: warn`). There is no message box: the same offence reads the
 * same whoever is on duty, and every warning points to a rule the admins wrote. The
 * picked template is shown filled in (`{user}`, `{type}`, `{where}`) so the moderator
 * sees exactly what the member will read. The server fills it in again from the
 * content itself (`POST /moderation/warnings` takes `templateId` + `target`), so this
 * preview is only a preview.
 *
 * A host global (`webWarnTemplateSelect`): the forum's warn dialog uses it too, so a
 * moderator gets the same list wherever they warn someone.
 */
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { authStore, userCan } from "../lib/authStore";
import { useDateTime } from "../lib/datetime";
import {
  WARN_EXPIRIES, fill, warnExpiryDate, warnExpiryLabel,
  type Template, type TemplateWords, type WarnExpiry,
} from "../features/modcp/modTemplates";

export interface WarnTemplateSelectProps {
  /** The picked template's id, `""` for none yet. */
  value: string;
  onChange: (templateId: string) => void;
  /** For the preview: who is warned, what kind of content (`article`, `post`…) and where it is. */
  user: string;
  type: string;
  where: string;
  /**
   * Another length than the template's (`""` = the template's). Only offered to a
   * holder of moderation.warn.expiry.override, and only when the dialog passes
   * `onExpiryChange`; send it as `expiry` when it is set.
   */
  expiry?: WarnExpiry | "";
  onExpiryChange?: (expiry: WarnExpiry | "") => void;
  className?: string;
  style?: React.CSSProperties;
}

export function WarnTemplateSelect({
  value, onChange, user, type, where, expiry = "", onExpiryChange, className, style,
}: WarnTemplateSelectProps) {
  const { t } = useTranslation("common", { keyPrefix: "warnTemplates" });
  const { t: tc } = useTranslation("common");
  const dt = useDateTime();
  const templatesQuery = useQuery<Template[]>({
    queryKey: ["mod-templates"],
    queryFn: () => api.get("/moderation/templates"),
    staleTime: 60_000,
  });
  const words = useQuery<TemplateWords>({
    queryKey: ["mod-template-words"],
    queryFn: () => api.get("/moderation/templates/words"),
    staleTime: 5 * 60_000,
  }).data;

  if (templatesQuery.isLoading) return null;
  const warns = (templatesQuery.data ?? []).filter((x) => x.mode === "warn");
  const picked = warns.find((x) => x.id === value);
  const typeWord = words?.type[type] ?? type;
  const canOverride = !!onExpiryChange && userCan(authStore.user, "moderation.warn.expiry.override");
  // What the member's warning will count for: the override, else the template's own.
  const effective: WarnExpiry | null = (canOverride && expiry) || picked?.warnExpiry || null;
  const until = warnExpiryDate(effective);

  if (warns.length === 0) {
    return (
      <p className={`xt-warn-tpl__none ${className ?? ""}`} style={style}>
        {t("none")}{" "}
        {userCan(authStore.user, "admin.access") && <Link to="/admin/mod-templates">{t("addOne")}</Link>}
      </p>
    );
  }

  return (
    <div className={className} style={style}>
      <label className="xt-warn-tpl__field">
        <span className="xt-warn-tpl__label">{t("label")}</span>
        <select className="xt-warn-tpl__select" value={value} onChange={(e) => onChange(e.target.value)} autoFocus>
          <option value="" disabled>{t("pick")}</option>
          {warns.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </label>
      {picked && (
        <div className="xt-warn-tpl__preview">
          <span className="xt-warn-tpl__label">{t("preview", { user })}</span>
          <p>{fill(picked.text, { user, type: typeWord, where, duration: "" })}</p>
          <span className="xt-warn-tpl__when">
            {until ? tc("modTiming.countsUntil", { user, date: dt.date(until) }) : tc("modTiming.countsForever", { user })}
          </span>
        </div>
      )}
      {picked && canOverride && (
        <label className="xt-warn-tpl__field xt-warn-tpl__override">
          <span className="xt-warn-tpl__label">{tc("modTiming.override")}</span>
          <select className="xt-warn-tpl__select" value={expiry} onChange={(e) => onExpiryChange!(e.target.value as WarnExpiry | "")}>
            <option value="">{tc("modTiming.label")}: {warnExpiryLabel(tc, picked.warnExpiry)}</option>
            {WARN_EXPIRIES.filter((x) => x !== picked.warnExpiry).map((x) => (
              <option key={x} value={x}>{warnExpiryLabel(tc, x)}</option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

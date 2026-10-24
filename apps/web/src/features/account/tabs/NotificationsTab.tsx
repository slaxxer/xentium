/**
 * Notifications — one row per event, one column per channel.
 *
 * ⚠ It used to be TWO lists ("in-app" and "email"), each with its own copy of the
 * same five events. Whether you get an email about mentions and whether you get a
 * bell about mentions is one decision about mentions, and splitting it meant
 * scrolling between two places to make it.
 *
 * ⚠ Not every event has an email channel, and the matrix says so with an em dash
 * rather than a switch that would silently do nothing. The server is the authority
 * on which ones do — `EMAIL_ITEMS` mirrors it.
 *
 * ⚠ A switch SAVES on click, as it always has. This tab has no save bar: see
 * `SaveBar`.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "../../../lib/toast";
import { api } from "../../../lib/api";
import { AccountCard, AccountSwitch } from "../components/AccountCard";
import { SavedChip } from "../components/SaveBar";

const IN_APP_ITEMS = [
  { id: "new_follower" }, { id: "profile_activity" }, { id: "mentions" },
  { id: "article_activity" }, { id: "progression" }, { id: "badges" },
] as const;

const EMAIL_ITEMS = [
  { id: "new_follower" }, { id: "profile_activity" }, { id: "mentions" },
] as const;

type InAppId = typeof IN_APP_ITEMS[number]["id"];
type EmailId = typeof EMAIL_ITEMS[number]["id"];

/** An add-on's notification type, as the server lists it for this member. */
interface AddonType { type: string; label: string; description: string | null; emailOffered: boolean; inApp: boolean; email: boolean }

export interface NotifPrefs {
  inApp: Record<InAppId, boolean>;
  email: Record<EmailId, boolean>;
  /** Add-ons' own types, grouped by add-on (only enabled ones, only what this member may get). */
  addons?: Array<{ pluginId: string; name: string; types: AddonType[] }>;
}

/** Exported for the rail's "N on" badge, which reads the same cache. */
export const NOTIF_DEFAULTS: NotifPrefs = {
  inApp: { new_follower: true, profile_activity: true, mentions: true, article_activity: true, progression: true, badges: true },
  email: { new_follower: false, profile_activity: false, mentions: false },
};

const EMAIL_IDS = new Set<string>(EMAIL_ITEMS.map((x) => x.id));

export function NotificationsTab() {
  const { t, i18n } = useTranslation("account");
  // An add-on's label may be a key in its own namespace; otherwise it is shown as written.
  const addonText = (s: string | null) => (s && s.includes(":") && i18n.exists(s) ? String(i18n.t(s)) : s ?? "");
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<NotifPrefs>({
    queryKey: ["account-notif-prefs"],
    queryFn:  () => api.get("/account/notifications"),
    placeholderData: NOTIF_DEFAULTS,
  });

  const mutation = useMutation({
    mutationFn: (prefs: NotifPrefs) => api.patch<NotifPrefs>("/account/notifications", {
      inApp: prefs.inApp,
      email: prefs.email,
      addons: Object.fromEntries((prefs.addons ?? []).flatMap((g) => g.types.map((x) => [x.type, { inApp: x.inApp, email: x.email }]))),
    }),
    onSuccess: (updated) => qc.setQueryData(["account-notif-prefs"], updated),
    onError: () => {
      // Put the switch back: the row must not show a state the server refused.
      void qc.invalidateQueries({ queryKey: ["account-notif-prefs"] });
      toast.error(t("notifications.saveError"));
    },
  });

  const prefs = data ?? NOTIF_DEFAULTS;

  const flip = (channel: "inApp" | "email", id: string, on: boolean) => {
    const next = { ...prefs, [channel]: { ...prefs[channel], [id]: on } } as NotifPrefs;
    // Optimistic: a switch that waits for a round-trip feels broken.
    qc.setQueryData(["account-notif-prefs"], next);
    mutation.mutate(next);
  };

  const flipAddon = (type: string, channel: "inApp" | "email") => {
    const next: NotifPrefs = {
      ...prefs,
      addons: (prefs.addons ?? []).map((g) => ({
        ...g, types: g.types.map((x) => (x.type === type ? { ...x, [channel]: !x[channel] } : x)),
      })),
    };
    qc.setQueryData(["account-notif-prefs"], next);
    mutation.mutate(next);
  };

  return (
    <>
      <AccountCard title={t("notifications.title")} desc={t("notifications.matrixDesc")}>
        <div className="acct-matrix" style={{ opacity: isLoading ? 0.5 : 1 }}>
          <div className="acct-matrix__head">
            <span>{t("notifications.colEvent")}</span>
            <span>{t("notifications.colInApp")}</span>
            <span>{t("notifications.colEmail")}</span>
          </div>

          {IN_APP_ITEMS.map((item) => {
            const hasEmail = EMAIL_IDS.has(item.id);
            return (
              <div key={item.id} className="acct-matrix__row">
                <span className="acct-matrix__event">
                  <span className="acct-row__label">{t(`notifications.items.${item.id}.label`)}</span>
                  <span className="acct-row__desc">{t(`notifications.items.${item.id}.desc`)}</span>
                </span>
                <span className="acct-matrix__cell">
                  <AccountSwitch
                    on={prefs.inApp[item.id]}
                    label={t("notifications.colInApp")}
                    onToggle={() => flip("inApp", item.id, !prefs.inApp[item.id])}
                  />
                </span>
                <span className="acct-matrix__cell">
                  {hasEmail
                    ? <AccountSwitch
                        on={prefs.email[item.id as EmailId]}
                        label={t("notifications.colEmail")}
                        onToggle={() => flip("email", item.id, !prefs.email[item.id as EmailId])}
                      />
                    // ⚠ An em dash, not a disabled switch: this event has no email
                    // channel at all, and a greyed switch reads as "off, for now".
                    : <span className="acct-matrix__none" aria-label={t("notifications.noEmailChannel")}>—</span>}
                </span>
              </div>
            );
          })}

          {(prefs.addons ?? []).map((g) => (
            <div key={g.pluginId} className="acct-matrix__group">
              <div className="acct-matrix__groupHead">{g.name}</div>
              {g.types.map((x) => (
                <div key={x.type} className="acct-matrix__row">
                  <span className="acct-matrix__event">
                    <span className="acct-row__label">{addonText(x.label)}</span>
                    {x.description && <span className="acct-row__desc">{addonText(x.description)}</span>}
                  </span>
                  <span className="acct-matrix__cell">
                    <AccountSwitch on={x.inApp} label={t("notifications.colInApp")} onToggle={() => flipAddon(x.type, "inApp")} />
                  </span>
                  <span className="acct-matrix__cell">
                    {x.emailOffered
                      ? <AccountSwitch on={x.email} label={t("notifications.colEmail")} onToggle={() => flipAddon(x.type, "email")} />
                      : <span className="acct-matrix__none" aria-label={t("notifications.noEmailChannel")}>—</span>}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </AccountCard>

      <SavedChip />
    </>
  );
}

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

export interface NotifPrefs {
  inApp: Record<InAppId, boolean>;
  email: Record<EmailId, boolean>;
}

/** Exported for the rail's "N on" badge, which reads the same cache. */
export const NOTIF_DEFAULTS: NotifPrefs = {
  inApp: { new_follower: true, profile_activity: true, mentions: true, article_activity: true, progression: true, badges: true },
  email: { new_follower: false, profile_activity: false, mentions: false },
};

const EMAIL_IDS = new Set<string>(EMAIL_ITEMS.map((x) => x.id));

export function NotificationsTab() {
  const { t } = useTranslation("account");
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<NotifPrefs>({
    queryKey: ["account-notif-prefs"],
    queryFn:  () => api.get("/account/notifications"),
    placeholderData: NOTIF_DEFAULTS,
  });

  const mutation = useMutation({
    mutationFn: (prefs: NotifPrefs) => api.patch<NotifPrefs>("/account/notifications", prefs),
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
        </div>
      </AccountCard>

      <SavedChip />
    </>
  );
}

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AccordionSection } from "../../../components/AccordionSection";
import { swalToast } from "../../../lib/swal";
import { api } from "../../../lib/api";

interface NotifToggleProps {
  label:    string;
  desc:     string;
  checked:  boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}

function NotifToggle({ label, desc, checked, onChange, disabled }: NotifToggleProps) {
  return (
    <label className="account-toggle" style={{ opacity: disabled ? 0.5 : 1 }}>
      <div className="account-toggle__text">
        <span className="account-toggle__label">{label}</span>
        <span className="account-toggle__desc">{desc}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className={`account-toggle__btn${checked ? " account-toggle__btn--on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className="account-toggle__knob" />
      </button>
    </label>
  );
}

const IN_APP_ITEMS = [
  { id: "new_follower" }, { id: "profile_activity" }, { id: "mentions" },
  { id: "article_activity" }, { id: "progression" }, { id: "badges" },
] as const;

const EMAIL_ITEMS = [
  { id: "new_follower" }, { id: "profile_activity" }, { id: "mentions" },
] as const;

type InAppId = typeof IN_APP_ITEMS[number]["id"];
type EmailId = typeof EMAIL_ITEMS[number]["id"];

interface NotifPrefs {
  inApp: Record<InAppId, boolean>;
  email: Record<EmailId, boolean>;
}

const DEFAULTS: NotifPrefs = {
  inApp: { new_follower: true, profile_activity: true, mentions: true, article_activity: true, progression: true, badges: true },
  email: { new_follower: false, profile_activity: false, mentions: false },
};

export function NotificationsTab() {
  const { t } = useTranslation("account");
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<NotifPrefs>({
    queryKey: ["account-notif-prefs"],
    queryFn:  () => api.get("/account/notifications"),
    placeholderData: DEFAULTS,
  });

  const mutation = useMutation({
    mutationFn: (prefs: NotifPrefs) => api.patch("/account/notifications", prefs),
    onSuccess: (updated) => {
      qc.setQueryData(["account-notif-prefs"], updated);
      swalToast(t("notifications.saved"), "success");
    },
    onError: () => swalToast(t("notifications.saveError")),
  });

  const prefs = data ?? DEFAULTS;

  function setInApp(id: InAppId, val: boolean) {
    const next = { ...prefs, inApp: { ...prefs.inApp, [id]: val } };
    mutation.mutate(next);
  }

  function setEmail(id: EmailId, val: boolean) {
    const next = { ...prefs, email: { ...prefs.email, [id]: val } };
    mutation.mutate(next);
  }

  return (
    <section className="account-section">
      <h2 className="account-section__title">{t("notifications.title")}</h2>

      <div className="security-accordion-list" style={{ opacity: isLoading ? 0.5 : 1, transition: "opacity .2s" }}>
        <AccordionSection title={t("notifications.inAppTitle")} defaultOpen={true}>
          <div className="security-accordion__content">
            {IN_APP_ITEMS.map((item) => (
              <NotifToggle
                key={item.id}
                label={t(`notifications.items.${item.id}.label`)}
                desc={t(`notifications.items.${item.id}.desc`)}
                checked={prefs.inApp[item.id]}
                disabled={mutation.isPending}
                onChange={(v) => setInApp(item.id, v)}
              />
            ))}
          </div>
        </AccordionSection>

        <AccordionSection title={t("notifications.emailTitle")}>
          <div className="security-accordion__content">
            {EMAIL_ITEMS.map((item) => (
              <NotifToggle
                key={item.id}
                label={t(`notifications.items.${item.id}.label`)}
                desc={t(`notifications.items.${item.id}.desc`)}
                checked={prefs.email[item.id]}
                disabled={mutation.isPending}
                onChange={(v) => setEmail(item.id, v)}
              />
            ))}
          </div>
        </AccordionSection>
      </div>
    </section>
  );
}

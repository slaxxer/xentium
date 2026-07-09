import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../../hooks/useAuth";
import { authStore } from "../../../lib/authStore";
import { api } from "../../../lib/api";
import { AccordionSection } from "../../../components/AccordionSection";
import { swalToast, apiErrorMessage } from "../../../lib/swal";
import { slotRegistry } from "../../../plugins/slotRegistry";

const LINK_KEYS = ["website", "github", "discord"];

interface PrivacySettings {
  allowProfileComments?: boolean;
  whoCanComment?: "everyone" | "following" | "nobody";
  whoCanFollow?: "everyone" | "nobody";
  showFollowersPublic?: boolean;
  showFollowingPublic?: boolean;
  hideBlockedContent?: boolean;
  profileVisibility?: "everyone" | "members";
  postHistoryVisibility?: "everyone" | "members" | "nobody";
  displayNamePreference?: "username" | "fullName";
}

const DEFAULTS: Required<PrivacySettings> = {
  allowProfileComments: true,
  whoCanComment: "everyone",
  whoCanFollow: "everyone",
  showFollowersPublic: true,
  showFollowingPublic: true,
  hideBlockedContent: false,
  profileVisibility: "everyone",
  postHistoryVisibility: "everyone",
  displayNamePreference: "username",
};

function Toggle({ label, desc, checked, onChange }: { label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="account-toggle">
      <div className="account-toggle__text">
        <span className="account-toggle__label">{label}</span>
        {desc && <span className="account-toggle__desc">{desc}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={`account-toggle__btn${checked ? " account-toggle__btn--on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className="account-toggle__knob" />
      </button>
    </label>
  );
}

function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="account-field">
      <label className="account-label">{label}</label>
      <select className="account-select" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

export function PrivacyTab() {
  const { t } = useTranslation("account");
  const { user } = useAuth();
  const [settings, setSettings] = useState<Required<PrivacySettings>>(DEFAULTS);

  // Birthday state
  const [dobDisplay, setDobDisplay] = useState<"hidden" | "age" | "birthday">(
    user?.dobDisplay ?? "age",
  );
  const [dobDate, setDobDate] = useState<string>("");
  const [dobVisibility, setDobVisibility] = useState<"public" | "members" | "nobody">("public");

  // Links visibility — single toggle for all link fields
  const [linksVisibility, setLinksVisibility] = useState<"public" | "members" | "nobody">("public");

  const [saving, setSaving] = useState(false);

  const { data: profileFields = [] } = useQuery({
    queryKey: ["account-profile-fields"],
    queryFn: () => api.get<Array<{ field: { id: string; key: string; label: string; type: string }; value: string; privacy: string }>>("/account/profile-fields"),
  });

  const dobField = profileFields.find((e) => e.field.key === "date_of_birth");

  useEffect(() => {
    if (dobField) {
      setDobDate(dobField.value ?? "");
      setDobVisibility((dobField.privacy as "public" | "members" | "nobody") ?? "public");
    }
    const firstLink = profileFields.find((e) => LINK_KEYS.includes(e.field.key));
    if (firstLink) {
      setLinksVisibility((firstLink.privacy as "public" | "members" | "nobody") ?? "public");
    }
  }, [profileFields]);

  const { data: loaded } = useQuery({
    queryKey: ["account", "privacy"],
    queryFn: () => api.get<PrivacySettings>("/account/privacy"),
  });

  useEffect(() => {
    if (loaded) setSettings({ ...DEFAULTS, ...loaded });
  }, [loaded]);

  function patch(partial: Partial<PrivacySettings>) {
    setSettings((prev) => ({ ...prev, ...partial }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      // Sync all link fields to the chosen linksVisibility
      const linkFieldUpdates = profileFields
        .filter((e) => LINK_KEYS.includes(e.field.key))
        .map((e) => ({ fieldId: e.field.id, value: e.value, privacy: linksVisibility }));

      await Promise.all([
        api.patch("/account/privacy", settings),
        api.patch("/account/profile", { dobDisplay }),
        dobField
          ? api.patch("/account/profile-fields", {
              values: [{ fieldId: dobField.field.id, value: dobDate, privacy: dobVisibility }],
            })
          : Promise.resolve(),
        linkFieldUpdates.length > 0
          ? api.patch("/account/profile-fields", { values: linkFieldUpdates })
          : Promise.resolve(),
      ]);
      if (authStore.user && authStore.token) {
        authStore.set(authStore.token, { ...authStore.user, dobDisplay });
      }
      swalToast(t("privacy.saved"), "success");
    } catch (e) {
      swalToast(apiErrorMessage(e, t("privacy.saveError")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="account-section">
      <h2 className="account-section__title">{t("privacy.title")}</h2>

      <form className="security-accordion-list" onSubmit={handleSubmit}>
        <AccordionSection title={t("privacy.birthday")} defaultOpen={true}>
          <div className="security-accordion__content">
            <div className="account-field">
              <label className="account-label" htmlFor="dob-date">{t("privacy.dobLabel")}</label>
              <input
                id="dob-date"
                className="account-input"
                type="date"
                value={dobDate}
                onChange={(e) => setDobDate(e.target.value)}
              />
            </div>
            <Select
              label={t("privacy.dobDisplayLabel")}
              value={dobDisplay}
              options={[
                { value: "hidden", label: t("privacy.dobHidden") },
                { value: "age", label: t("privacy.dobAge") },
                { value: "birthday", label: t("privacy.dobBirthday") },
              ]}
              onChange={(v) => setDobDisplay(v)}
            />
            <Select
              label={t("privacy.dobWhoLabel")}
              value={dobVisibility}
              options={[
                { value: "public", label: t("privacy.optEveryoneGuests") },
                { value: "members", label: t("privacy.optMembersOnly") },
                { value: "nobody", label: t("privacy.optNobody") },
              ]}
              onChange={(v) => setDobVisibility(v)}
            />
          </div>
        </AccordionSection>

        <AccordionSection title={t("privacy.links")}>
          <div className="security-accordion__content">
            <Select
              label={t("privacy.linksWhoLabel")}
              value={linksVisibility}
              options={[
                { value: "public",  label: t("privacy.optEveryoneGuests") },
                { value: "members", label: t("privacy.optMembersOnly") },
                { value: "nobody",  label: t("privacy.optNobody") },
              ]}
              onChange={(v) => setLinksVisibility(v)}
            />
          </div>
        </AccordionSection>

        <AccordionSection title={t("privacy.wall")}>
          <div className="security-accordion__content">
            <Toggle
              label={t("privacy.allowComments")}
              desc={t("privacy.allowCommentsDesc")}
              checked={settings.allowProfileComments}
              onChange={(v) => patch({ allowProfileComments: v })}
            />
            <Select
              label={t("privacy.whoCommentLabel")}
              value={settings.whoCanComment}
              options={[
                { value: "everyone", label: t("privacy.optEveryone") },
                { value: "following", label: t("privacy.optFollowing") },
                { value: "nobody", label: t("privacy.optNobody") },
              ]}
              onChange={(v) => patch({ whoCanComment: v })}
            />
          </div>
        </AccordionSection>

        <AccordionSection title={t("privacy.followVis")}>
          <div className="security-accordion__content">
            <Select
              label={t("privacy.whoFollowLabel")}
              value={settings.whoCanFollow}
              options={[
                { value: "everyone", label: t("privacy.optEveryone") },
                { value: "nobody", label: t("privacy.optNobody") },
              ]}
              onChange={(v) => patch({ whoCanFollow: v })}
            />
            <Toggle
              label={t("privacy.showFollowers")}
              desc={t("privacy.showFollowersDesc")}
              checked={settings.showFollowersPublic}
              onChange={(v) => patch({ showFollowersPublic: v })}
            />
            <Toggle
              label={t("privacy.showFollowing")}
              desc={t("privacy.showFollowingDesc")}
              checked={settings.showFollowingPublic}
              onChange={(v) => patch({ showFollowingPublic: v })}
            />
            {/* "Hide blocked users' content" removed: blocking now always hides
                content everywhere, so the toggle is redundant. The hideBlockedContent
                setting key is retained server-side for backwards compatibility. */}
            {slotRegistry.getPrivacySections().map((s) => (
              <s.component key={s.id} />
            ))}
          </div>
        </AccordionSection>

        <AccordionSection title={t("privacy.profileVis")}>
          <div className="security-accordion__content">
            {user?.displayName && (
              <Select
                label={t("privacy.displayNameLabel")}
                value={settings.displayNamePreference}
                options={[
                  { value: "username", label: t("privacy.displayNameUsername") },
                  { value: "fullName", label: t("privacy.displayNameFull") },
                ]}
                onChange={(v) => patch({ displayNamePreference: v })}
              />
            )}
            <Select
              label={t("privacy.profileWhoLabel")}
              value={settings.profileVisibility}
              options={[
                { value: "everyone", label: t("privacy.optEveryoneGuests") },
                { value: "members", label: t("privacy.optLoggedInMembers") },
              ]}
              onChange={(v) => patch({ profileVisibility: v })}
            />
            <Select
              label={t("privacy.postHistoryLabel")}
              value={settings.postHistoryVisibility}
              options={[
                { value: "everyone", label: t("privacy.optEveryone") },
                { value: "members", label: t("privacy.optMembersOnly") },
                { value: "nobody", label: t("privacy.optNobody") },
              ]}
              onChange={(v) => patch({ postHistoryVisibility: v })}
            />
          </div>
        </AccordionSection>

        <div className="account-actions">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? t("privacy.saving") : t("privacy.save")}
          </button>
        </div>
      </form>
    </section>
  );
}

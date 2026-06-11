import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../../hooks/useAuth";
import { authStore } from "../../../lib/authStore";
import { api } from "../../../lib/api";
import { swalToast, apiErrorMessage } from "../../../lib/swal";
import { AccordionSection } from "../../../components/AccordionSection";
import { slotRegistry } from "../../../plugins/slotRegistry";

interface FieldDef {
  id: string;
  key: string;
  label: string;
  type: string;
  placeholder: string | null;
  dobDisplayFormat: string | null;
}

interface ProfileFieldEntry {
  field: FieldDef;
  value: string;
  privacy: "public" | "members" | "nobody";
}

const PRIVACY_OPTIONS = ["public", "members", "nobody"] as const;

const LINK_KEYS = ["website", "github", "discord"];

export function ProfileTab() {
  const { t } = useTranslation("account");
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [bio, setBio] = useState(user?.bio ?? "");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  const { data: profileFields = [] } = useQuery<ProfileFieldEntry[]>({
    queryKey: ["account-profile-fields"],
    queryFn: () => api.get("/account/profile-fields"),
  });

  const [fieldValues, setFieldValues] = useState<Record<string, { value: string; privacy: string }>>({});

  useEffect(() => {
    const fields = profileFields.filter((e) => e.field.key !== "date_of_birth");
    if (fields.length > 0) {
      setFieldValues(
        Object.fromEntries(
          profileFields.map((e) => [e.field.id, { value: e.value, privacy: e.privacy }]),
        ),
      );
    }
  }, [profileFields]);

  const avatarMutation = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return api.post<{ url: string }>("/account/avatar", fd);
    },
    onSuccess: (data) => {
      if (authStore.user && authStore.token) {
        authStore.set(authStore.token, { ...authStore.user, avatar: data.url });
      }
      queryClient.invalidateQueries({ queryKey: ["profile", user?.username] });
      swalToast(t("profile.photoUpdated"), "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e, t("profile.uploadFailed"))),
  });

  const bioMutation = useMutation({
    mutationFn: (data: { bio: string }) => api.patch("/account/profile", data),
    onSuccess: (updated: any) => {
      authStore.set(authStore.token!, { ...authStore.user!, bio: updated.bio });
      queryClient.invalidateQueries({ queryKey: ["profile", user?.username] });
      swalToast(t("profile.bioSaved"), "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e, t("profile.saveError"))),
  });

  const fieldsMutation = useMutation({
    mutationFn: (values: Array<{ fieldId: string; value: string; privacy: string }>) =>
      api.patch("/account/profile-fields", { values }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["account-profile-fields"] });
      swalToast(t("profile.profileInfoSaved"), "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e, t("profile.saveError"))),
  });

  const linksMutation = useMutation({
    mutationFn: (values: Array<{ fieldId: string; value: string; privacy: string }>) =>
      api.patch("/account/profile-fields", { values }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["account-profile-fields"] });
      swalToast(t("profile.linksSaved"), "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e, t("profile.saveError"))),
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const preview = URL.createObjectURL(file);
    setAvatarPreview(preview);
    avatarMutation.mutate(file);
  }

  function handleBioSubmit(e: React.FormEvent) {
    e.preventDefault();
    bioMutation.mutate({ bio });
  }

  function handleLinksSubmit(e: React.FormEvent) {
    e.preventDefault();
    const values = linkFields.map((entry) => ({
      fieldId: entry.field.id,
      value: fieldValues[entry.field.id]?.value ?? entry.value,
      privacy: fieldValues[entry.field.id]?.privacy ?? entry.privacy,
    }));
    linksMutation.mutate(values);
  }

  function handleFieldsSubmit(e: React.FormEvent) {
    e.preventDefault();
    const values = otherFields.map((entry) => ({
      fieldId: entry.field.id,
      value: fieldValues[entry.field.id]?.value ?? entry.value,
      privacy: fieldValues[entry.field.id]?.privacy ?? entry.privacy,
    }));
    fieldsMutation.mutate(values);
  }

  function setFieldValue(fieldId: string, value: string) {
    setFieldValues((prev) => ({
      ...prev,
      [fieldId]: { value, privacy: prev[fieldId]?.privacy ?? "public" },
    }));
  }

  function setFieldPrivacy(fieldId: string, privacy: string) {
    setFieldValues((prev) => ({
      ...prev,
      [fieldId]: { value: prev[fieldId]?.value ?? "", privacy },
    }));
  }

  const initials = user?.username ? user.username.slice(0, 2).toUpperCase() : "?";
  const avatarSrc = avatarPreview ?? (user?.avatar ? user.avatar : null);
  const allVisibleFields = profileFields.filter((e) => e.field.key !== "date_of_birth");
  const linkFields = allVisibleFields.filter((e) => LINK_KEYS.includes(e.field.key));
  const otherFields = allVisibleFields.filter((e) => !LINK_KEYS.includes(e.field.key));

  return (
    <section className="account-section">
      <h2 className="account-section__title">{t("profile.title")}</h2>

      <div className="security-accordion-list">
        <AccordionSection title={t("profile.avatar")} defaultOpen={true}>
          <div className="security-accordion__content">
            <div className="account-avatar-section" style={{ marginBottom: 0, paddingBottom: 0, border: "none" }}>
              <div className="account-avatar">
                {avatarSrc ? (
                  <img
                    src={avatarSrc}
                    alt={user?.username}
                    style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }}
                  />
                ) : (
                  initials
                )}
              </div>
              <div className="account-avatar-info">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  style={{ display: "none" }}
                  onChange={handleFileChange}
                />
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={avatarMutation.isPending}
                >
                  {avatarMutation.isPending ? t("profile.uploading") : t("profile.changePhoto")}
                </button>
                <p className="account-avatar-hint">{t("profile.avatarHint")}</p>
              </div>
            </div>
          </div>
        </AccordionSection>

        <AccordionSection title={t("profile.bioSection")}>
          <div className="security-accordion__content">
            <form className="account-form" onSubmit={handleBioSubmit}>
              <div className="account-field">
                <label className="account-label" htmlFor="bio">{t("profile.bioLabel")}</label>
                <textarea
                  id="bio"
                  className="account-input account-input--textarea"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  maxLength={500}
                  rows={4}
                  placeholder={t("profile.bioPlaceholder")}
                />
                <p className="account-hint">{bio.length}/500</p>
              </div>
              <div className="account-actions">
                <button type="submit" className="btn-primary" disabled={bioMutation.isPending}>
                  {bioMutation.isPending ? t("profile.saving") : t("profile.saveBio")}
                </button>
              </div>
            </form>
          </div>
        </AccordionSection>

        {slotRegistry.getAccountSections().map((s) => (
          <AccordionSection key={s.id} title={s.label}>
            <div className="security-accordion__content">
              <s.component />
            </div>
          </AccordionSection>
        ))}

        <AccordionSection title={t("profile.links")}>
          <div className="security-accordion__content">
            <form onSubmit={handleLinksSubmit}>
              {linkFields.map((entry) => {
                const f = entry.field;
                const current = fieldValues[f.id] ?? { value: entry.value, privacy: entry.privacy };
                return (
                  <div key={f.id} className="account-field">
                    <label className="account-label" htmlFor={`lf-${f.id}`}>{f.label}</label>
                    <input
                      id={`lf-${f.id}`}
                      className="account-input"
                      type={f.type === "url" ? "url" : "text"}
                      value={current.value}
                      onChange={(e) => setFieldValue(f.id, e.target.value)}
                      placeholder={f.placeholder ?? ""}
                    />
                  </div>
                );
              })}
              <p className="account-hint" style={{ marginBottom: "var(--sp-4)" }}>
                {t("profile.linksHint")}
              </p>
              <div className="account-actions">
                <button type="submit" className="btn-primary" disabled={linksMutation.isPending}>
                  {linksMutation.isPending ? t("profile.saving") : t("profile.saveLinks")}
                </button>
              </div>
            </form>
          </div>
        </AccordionSection>

        {otherFields.length > 0 && (
          <AccordionSection title={t("profile.profileInfo")}>
            <div className="security-accordion__content">
              <form onSubmit={handleFieldsSubmit}>
                {otherFields.map((entry) => {
                  const f = entry.field;
                  const current = fieldValues[f.id] ?? { value: entry.value, privacy: entry.privacy };
                  return (
                    <div key={f.id} className="account-field account-field--with-privacy">
                      <label className="account-label" htmlFor={`pf-${f.id}`}>{f.label}</label>
                      <div className="account-field-row">
                        <input
                          id={`pf-${f.id}`}
                          className="account-input"
                          type={f.type === "email" ? "email" : f.type === "url" ? "url" : "text"}
                          value={current.value}
                          onChange={(e) => setFieldValue(f.id, e.target.value)}
                          placeholder={f.placeholder ?? ""}
                        />
                        <select
                          className="account-select account-select--privacy"
                          value={current.privacy}
                          onChange={(e) => setFieldPrivacy(f.id, e.target.value)}
                          aria-label={t("profile.fieldVisibility", { label: f.label })}
                        >
                          {PRIVACY_OPTIONS.map((o) => (
                            <option key={o} value={o}>{t(`profile.privacyOpt.${o}`)}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })}
                <div className="account-actions">
                  <button type="submit" className="btn-primary" disabled={fieldsMutation.isPending}>
                    {fieldsMutation.isPending ? t("profile.saving") : t("profile.saveProfileInfo")}
                  </button>
                </div>
              </form>
            </div>
          </AccordionSection>
        )}
      </div>
    </section>
  );
}

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../../lib/api";
import { swalToast, apiErrorMessage, swalConfirm } from "../../../lib/swal";
import { FontAwesomeIcon } from "../../../components/Icon";
import { faPlus, faPencil, faTrash, faLock } from "@fortawesome/free-solid-svg-icons";
import { fieldLabel } from "../../../lib/coreText";

interface ProfileField {
  id: string;
  key: string;
  label: string;
  type: "text" | "date" | "email" | "url";
  placeholder: string | null;
  showOnRegistration: boolean;
  requiredOnRegistration: boolean;
  showOnProfile: boolean;
  isSystem: boolean;
  position: number;
  dobDisplayFormat: string | null;
}

interface FieldFormData {
  key: string;
  label: string;
  type: string;
  placeholder: string;
  showOnRegistration: boolean;
  requiredOnRegistration: boolean;
  showOnProfile: boolean;
  dobDisplayFormat: string;
}

const FIELD_TYPES = [
  { value: "text",  labelKey: "profileFields.typeText" },
  { value: "date",  labelKey: "profileFields.typeDate" },
  { value: "email", labelKey: "profileFields.typeEmail" },
  { value: "url",   labelKey: "profileFields.typeUrl" },
];

function FieldModal({
  field,
  onClose,
  onSave,
}: {
  field: Partial<ProfileField> | null;
  onClose: () => void;
  onSave: (data: FieldFormData) => void;
}) {
  const { t } = useTranslation("acp");
  const isNew = !field?.id;
  const [form, setForm] = useState({
    key: field?.key ?? "",
    label: field?.label ?? "",
    type: field?.type ?? "text",
    placeholder: field?.placeholder ?? "",
    showOnRegistration: field?.showOnRegistration ?? false,
    requiredOnRegistration: field?.requiredOnRegistration ?? false,
    showOnProfile: field?.showOnProfile ?? true,
    dobDisplayFormat: field?.dobDisplayFormat ?? "age",
  });

  function set(k: string, v: string | boolean) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  return (
    <div className="acp-modal-overlay" onClick={onClose}>
      <div className="acp-modal" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginBottom: "1.5rem", fontSize: "1.1rem" }}>
          {isNew ? t("profileFields.modalAddTitle") : t("profileFields.modalEditTitle", { label: field?.key && field.label ? fieldLabel({ key: field.key, label: field.label }) : field?.label })}
        </h2>

        {isNew && (
          <div className="acp-form-field">
            <label className="acp-label">{t("profileFields.keyLabel")}</label>
            <input
              className="acp-input"
              value={form.key}
              onChange={(e) => set("key", e.target.value)}
              placeholder={t("profileFields.keyPlaceholder")}
            />
          </div>
        )}

        <div className="acp-form-field">
          <label className="acp-label">{t("profileFields.labelLabel")}</label>
          <input
            className="acp-input"
            value={form.label}
            onChange={(e) => set("label", e.target.value)}
            placeholder={t("profileFields.labelPlaceholder")}
          />
        </div>

        {isNew && (
          <div className="acp-form-field">
            <label className="acp-label">{t("profileFields.typeLabel")}</label>
            <select
              className="acp-select"
              value={form.type}
              onChange={(e) => set("type", e.target.value)}
            >
              {FIELD_TYPES.map((ft) => (
                <option key={ft.value} value={ft.value}>{t(ft.labelKey)}</option>
              ))}
            </select>
          </div>
        )}

        {form.type === "date" && (
          <div className="acp-form-field">
            <label className="acp-label">{t("profileFields.dobFormatLabel")}</label>
            <select
              className="acp-select"
              value={form.dobDisplayFormat ?? "age"}
              onChange={(e) => set("dobDisplayFormat", e.target.value)}
            >
              <option value="age">{t("profileFields.dobAge")}</option>
              <option value="birthday">{t("profileFields.dobBirthday")}</option>
              <option value="full">{t("profileFields.dobFull")}</option>
            </select>
          </div>
        )}

        <div className="acp-form-field">
          <label className="acp-label">{t("profileFields.placeholderLabel")}</label>
          <input
            className="acp-input"
            value={form.placeholder}
            onChange={(e) => set("placeholder", e.target.value)}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", margin: "1rem 0" }}>
          <label className="acp-checkbox-row">
            <input
              type="checkbox"
              checked={form.showOnRegistration}
              onChange={(e) => set("showOnRegistration", e.target.checked)}
            />
            <span>{t("profileFields.showOnRegistration")}</span>
          </label>
          <label className="acp-checkbox-row">
            <input
              type="checkbox"
              checked={form.requiredOnRegistration}
              disabled={!form.showOnRegistration}
              onChange={(e) => set("requiredOnRegistration", e.target.checked)}
            />
            <span style={{ opacity: form.showOnRegistration ? 1 : 0.4 }}>{t("profileFields.requiredAtRegistration")}</span>
          </label>
          <label className="acp-checkbox-row">
            <input
              type="checkbox"
              checked={form.showOnProfile}
              onChange={(e) => set("showOnProfile", e.target.checked)}
            />
            <span>{t("profileFields.showOnProfile")}</span>
          </label>
        </div>

        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>{t("common:actions.cancel")}</button>
          <button type="button" className="btn-primary btn-sm" onClick={() => onSave(form)}>
            {isNew ? t("profileFields.createField") : t("profileFields.saveChanges")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProfileFieldsPage() {
  const { t } = useTranslation("acp");
  const queryClient = useQueryClient();
  const [editField, setEditField] = useState<Partial<ProfileField> | null | "new">(null);

  const { data: fields = [], isLoading } = useQuery<ProfileField[]>({
    queryKey: ["acp-profile-fields"],
    queryFn: () => api.get("/admin/profile-fields"),
  });

  const createMutation = useMutation({
    mutationFn: (data: FieldFormData) => api.post("/admin/profile-fields", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["acp-profile-fields"] });
      swalToast(t("profileFields.created"), "success");
      setEditField(null);
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<FieldFormData> }) =>
      api.patch(`/admin/profile-fields/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["acp-profile-fields"] });
      swalToast(t("profileFields.updated"), "success");
      setEditField(null);
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/profile-fields/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["acp-profile-fields"] });
      swalToast(t("profileFields.deleted"), "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  async function handleDelete(field: ProfileField) {
    const result = await swalConfirm(
      t("profileFields.deleteConfirmTitle"),
      t("profileFields.deleteConfirmBody", { label: fieldLabel(field) }),
      t("profileFields.deleteConfirmBtn"),
      t("common:actions.cancel"),
    );
    if (result) deleteMutation.mutate(field.id);
  }

  function handleSave(data: FieldFormData) {
    if (editField === "new") {
      createMutation.mutate(data);
    } else if (editField && "id" in editField) {
      const { key: _key, type: _type, ...updateData } = data;
      updateMutation.mutate({ id: editField.id!, data: updateData });
    }
  }

  return (
    <div>
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">{t("nav.members")}</div>
          <h1 className="acp-page-title">{t("nav.profileFields")}</h1>
        </div>
        <button type="button" className="btn-primary btn-sm" onClick={() => setEditField("new")}>
          <FontAwesomeIcon icon={faPlus} /> {t("profileFields.addField")}
        </button>
      </div>

      <div className="acp-card">
        {isLoading ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--c-fg-muted)" }}>{t("profileFields.loading")}</div>
        ) : (
          <table className="acp-table">
            <thead>
              <tr>
                <th>{t("profileFields.colLabel")}</th>
                <th>{t("profileFields.colKey")}</th>
                <th>{t("profileFields.colType")}</th>
                <th>{t("profileFields.colRegistration")}</th>
                <th>{t("profileFields.colProfile")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.id}>
                  <td>
                    {f.isSystem && (
                      <FontAwesomeIcon icon={faLock} style={{ marginRight: "0.4rem", color: "var(--c-fg-muted)", fontSize: "0.75rem" }} />
                    )}
                    {fieldLabel(f)}
                  </td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.8rem", color: "var(--c-fg-muted)" }}>
                    {f.key}
                  </td>
                  <td>
                    <span className="acp-badge acp-badge--neutral">{f.type}</span>
                  </td>
                  <td>
                    {f.showOnRegistration ? (
                      <span className="acp-badge acp-badge--success">
                        {f.requiredOnRegistration ? t("profileFields.regRequired") : t("profileFields.regOptional")}
                      </span>
                    ) : (
                      <span className="acp-badge acp-badge--muted">{t("profileFields.hidden")}</span>
                    )}
                  </td>
                  <td>
                    {f.showOnProfile ? (
                      <span className="acp-badge acp-badge--success">{t("profileFields.shown")}</span>
                    ) : (
                      <span className="acp-badge acp-badge--muted">{t("profileFields.hidden")}</span>
                    )}
                  </td>
                  <td style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => setEditField(f)}
                    >
                      <FontAwesomeIcon icon={faPencil} />
                    </button>
                    {!f.isSystem && (
                      <button
                        type="button"
                        className="btn-danger btn-sm"
                        onClick={() => handleDelete(f)}
                      >
                        <FontAwesomeIcon icon={faTrash} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {fields.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", color: "var(--c-fg-muted)", padding: "2rem" }}>
                    {t("profileFields.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {editField !== null && (
        <FieldModal
          field={editField === "new" ? {} : editField}
          onClose={() => setEditField(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

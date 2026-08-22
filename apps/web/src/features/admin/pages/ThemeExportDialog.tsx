/**
 * Export a `.nvtheme`, asked for in a dialog.
 *
 * The manifest is eight fields an admin fills in once per release, which is a form,
 * not a toolbar. It used to sit expanded inside the Layout Editor as a row of unlabelled
 * inputs competing for width with the editor itself; here each field gets a label and a
 * hint, and the editor gets its width back.
 *
 * The dialog primitive takes a static `bodyNode`, so the form owns its own state and
 * pushes every change into a draft object the caller reads on confirm. That also means
 * a rejected export can simply RE-OPEN with everything still typed in.
 */
import { useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { openDialog } from "../../../lib/dialog";
import { toast } from "../../../lib/toast";

export interface ThemeExportMeta {
  id: string;
  name: string;
  version: string;
  vendor: string;
  license: string;
  homepage: string;
  authorUrl: string;
  /** Palette only — no layouts, and therefore no assets. */
  tokensOnly: boolean;
}

const BLANK: ThemeExportMeta = {
  id: "my-theme", name: "My theme", version: "1.0.0", vendor: "",
  license: "", homepage: "", authorUrl: "", tokensOnly: false,
};

/** The manifest fields the API accepts from an author, with their labels. */
const FIELDS: { key: keyof ThemeExportMeta; label: string; placeholder?: string; type?: string }[] = [
  { key: "id",        label: "fieldId",        placeholder: "my-theme" },
  { key: "name",      label: "fieldName",      placeholder: "My theme" },
  { key: "version",   label: "fieldVersion",   placeholder: "1.0.0" },
  { key: "vendor",    label: "fieldVendor" },
  { key: "license",   label: "fieldLicense",   placeholder: "MIT" },
  { key: "homepage",  label: "fieldHomepage",  type: "url" },
  { key: "authorUrl", label: "fieldAuthorUrl", type: "url" },
];

function ThemeExportForm({ initial, onChange }: {
  initial: ThemeExportMeta;
  onChange: (next: ThemeExportMeta) => void;
}) {
  const { t } = useTranslation("acp");
  const [value, setValue] = useState(initial);
  const set = (patch: Partial<ThemeExportMeta>) => {
    const next = { ...value, ...patch };
    setValue(next);
    onChange(next);
  };

  return (
    <div className="thm-form">
      <p className="thm-form__hint">{t("themes.exportHint")}</p>

      <div className="thm-form__grid">
        {FIELDS.map(({ key, label, placeholder, type }) => (
          <label key={key} className="thm-form__field">
            <span>
              {t(`themes.${label}`)}
              {/* The API requires a vendor; everything else is genuinely optional and
                  is omitted from the manifest rather than sent as an empty string. */}
              {(key === "id" || key === "name" || key === "version" || key === "vendor") && (
                <em className="thm-form__req"> *</em>
              )}
            </span>
            <input
              className="acp-input"
              type={type ?? "text"}
              value={value[key] as string}
              placeholder={placeholder}
              onChange={(e) => set({ [key]: e.target.value } as Partial<ThemeExportMeta>)}
            />
          </label>
        ))}
      </div>

      <label className="thm-form__check">
        <input type="checkbox" checked={value.tokensOnly}
          onChange={(e) => set({ tokensOnly: e.target.checked })} />
        <span>
          <b>{t("themes.tokensOnly")}</b>
          <em>{t("themes.tokensOnlyHint")}</em>
        </span>
      </label>
    </div>
  );
}

/** Fields the manifest cannot be built without. */
const REQUIRED: (keyof ThemeExportMeta)[] = ["id", "name", "version", "vendor"];

/**
 * Ask for the manifest, and keep asking while it is incomplete.
 *
 * Re-opening rather than validating inline because the dialog's confirm button is not
 * ours to disable — and re-opening costs nothing, since the draft survives it. Resolves
 * `null` when the admin cancels.
 */
export async function openThemeExportDialog(t: TFunction): Promise<ThemeExportMeta | null> {
  const draft: ThemeExportMeta = { ...BLANK };

  for (;;) {
    const confirmed = await openDialog({
      kind: "confirm",
      icon: "info",
      wide: true,
      title: t("themes.exportTitle"),
      bodyNode: (
        <ThemeExportForm initial={{ ...draft }} onChange={(next) => Object.assign(draft, next)} />
      ),
      confirmText: t("themes.exportBtn"),
      cancelText:  t("themes.cancel"),
    });
    if (!confirmed) return null;

    const missing = REQUIRED.filter((k) => !String(draft[k]).trim());
    if (!missing.length) return draft;

    toast.error(t("themes.exportMissing", {
      fields: missing.map((k) => t(`themes.field${k[0]!.toUpperCase()}${k.slice(1)}`)).join(", "),
    }));
  }
}

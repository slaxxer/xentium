/**
 * "Editing: <theme>" — which theme an Appearance editor is working on.
 *
 * Every installed theme and the built-in Core theme carry their own layouts, colours,
 * fonts, custom CSS and site frame. The choice is made on the Themes page and lives in
 * the editor's URL (`?theme=`), so a reload keeps it. Absent = the live theme.
 */
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../../lib/api";
import { CORE_THEME_PARAM, useEditingTheme } from "../../../lib/editingTheme";
import "./ThemeScopePicker.scss";

export interface LibraryTheme {
  id: string; name: string; version: string; active: boolean;
  /** The package manifest — `colourways` is what the Layout Editor reads from it. */
  manifest?: Record<string, unknown> | null;
}

export function useThemeLibrary() {
  return useQuery<{ themes: LibraryTheme[] }>({
    queryKey: ["acp-theme-library"],
    queryFn:  () => api.get("/admin/themes/library"),
    staleTime: 30_000,
  });
}

/**
 * Which theme this editor is working on — a label, not a choice: the editors are
 * opened from a theme on the Themes page, so the theme is already decided.
 */
export function ThemeScopePicker() {
  const { t } = useTranslation("acp");
  const { key } = useEditingTheme();
  const { data } = useThemeLibrary();
  const themes = data?.themes ?? [];
  const live = themes.find((x) => x.active)?.id ?? CORE_THEME_PARAM;
  const current = key ?? live;
  const isLive = current === live;
  const theme = themes.find((x) => x.id === current);
  // Nothing until the library answers, rather than flashing the raw theme id.
  const name = current === CORE_THEME_PARAM ? t("themeScope.core") : theme ? `${theme.name} ${theme.version}` : "";
  if (!data) return null;

  return (
    <div className="theme-scope">
      <span className="theme-scope__label">{t("themeScope.editing")}</span>
      <span className="theme-scope__name">{name}</span>
      <span className={`theme-scope__state${isLive ? " is-live" : ""}`}>
        {t(isLive ? "themeScope.isLive" : "themeScope.notLive")}
      </span>
    </div>
  );
}

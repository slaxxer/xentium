import type { TFunction } from "i18next";
import { api } from "../../../lib/api";
import { openDialog } from "../../../lib/dialog";
import { toast } from "../../../lib/toast";
import { apiErrorMessage } from "../../../lib/swal";
import { resolveImageSource } from "../../../layout/blocks/coreBlocks";
import "./themeSwitchPrompt.scss";

/**
 * "Switch to the theme you just installed, or keep the one the site wears?"
 *
 * Installing and switching are two decisions. An import lands in the library
 * inactive (unless it is an update to the theme already being worn — the server
 * applies that and says `activated: true`), and this is where the admin makes the
 * second decision.
 *
 * ONE prompt for every way a theme gets installed — the Themes page upload, the
 * Marketplace grid and the owned-licence rows — for the same reason
 * `themeInstallMessage` is shared: three copies of a decision drift.
 *
 * "Switch" is the ordinary library activation: live at once, with the undo point
 * every activation records. "Keep" does nothing; the theme waits in the library.
 */

/** What an install reported — the fields every entry point receives. */
export interface ThemeInstallOutcome {
  id: string;
  name: string;
  activated?: boolean;
  /** The theme still being worn; null means stock Xentium. */
  current?: { id: string; name: string } | null;
}

/** The streamed marketplace install's terminal event, read as an outcome. */
export function outcomeFromStream(
  id: string, name: string, final: Record<string, unknown> | null | undefined,
): ThemeInstallOutcome {
  const current = final?.current as { id?: unknown; name?: unknown } | null | undefined;
  return {
    id, name,
    // Absent (an older API) reads as "already applied", which is what it was then.
    activated: final?.activated === false ? false : true,
    current: current && typeof current.name === "string"
      ? { id: String(current.id ?? ""), name: current.name }
      : null,
  };
}

interface LibraryRow {
  id: string;
  name: string;
  screenshot: string | null;
  manifest?: { appearance?: "light" | "dark" };
}

/**
 * Ask, and switch if told to. Resolves true when the site now wears the new theme —
 * including when the install already put it on (an update), so a caller can
 * invalidate on one answer.
 */
export async function offerThemeSwitch(t: TFunction, outcome: ThemeInstallOutcome): Promise<boolean> {
  if (outcome.activated !== false) return outcome.activated === true;

  // The library row, not the install report: it carries the screenshot at the path it
  // was unpacked to on THIS site, and the manifest's declared appearance.
  const row = await api.get<{ themes: LibraryRow[] }>("/admin/themes/library")
    .then((r) => r.themes.find((th) => th.id === outcome.id))
    .catch(() => undefined);

  const name     = row?.name ?? outcome.name;
  const current  = outcome.current?.name ?? null;
  const look     = row?.manifest?.appearance;

  const ok = await openDialog({
    kind:  "confirm",
    icon:  "question",
    title: t("themes.switchTitle", { name }),
    bodyNode: (
      <div className="thm-switch">
        {row?.screenshot && (
          <img className="thm-switch__shot" src={resolveImageSource(row.screenshot)} alt="" />
        )}
        {look && (
          <span className="thm-switch__look">
            {t(look === "dark" ? "themes.lookDark" : "themes.lookLight")}
          </span>
        )}
        <p className="thm-switch__text">
          {current
            ? t("themes.switchBody", { name, current })
            : t("themes.switchBodyStock", { name })}
        </p>
      </div>
    ),
    confirmText: t("themes.switchBtn", { name }),
    cancelText:  current ? t("themes.keepBtn", { name: current }) : t("themes.keepStockBtn"),
  });

  if (!ok) {
    toast.info(t("themes.keptInLibrary", { name }));
    return false;
  }

  try {
    await api.post(`/admin/themes/library/${outcome.id}/activate`, {});
    toast.success(t("themes.activated", { name }));
    return true;
  } catch (e) {
    toast.error(apiErrorMessage(e));
    return false;
  }
}

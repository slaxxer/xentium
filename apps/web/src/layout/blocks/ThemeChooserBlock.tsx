/**
 * THE THEME CHOOSER — the reader picks which installed theme to read the site in.
 *
 * A site has one active theme: the admin's, with the admin's edits over it. This
 * offers the others that are installed, for this visitor only. Nothing on the server
 * changes, nobody else sees it, and the site's own theme is always first and default.
 *
 * ⚠ A chosen theme is that theme AS ITS AUTHOR SHIPPED IT — its tokens and its
 * layout documents, with no admin layer over them. The admin's overrides were
 * authored against the active theme and mean nothing on another one.
 *
 * ⚠ Switching RELOADS. Both the stylesheet and the layout documents change together,
 * and every open query, every mounted block and the SSE reconciler would otherwise
 * have to be talked through it — for something a reader does once.
 *
 * An ICON opening a DIALOG rather than a select: a theme is a look, and a list of
 * names asks someone to choose one sight unseen. The dialog shows each theme's
 * thumbnail and what it says about itself, which is the only way the choice means
 * anything before it is made.
 *
 * ⚠ Compact ROWS, not a grid of cards. A footer control that fills the screen to
 * offer three options is a dialog pretending to be a page — the thumbnail only has
 * to be big enough to tell two themes apart, and the description reads better on one
 * line beside it than under a picture.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "../../components/Icon";
import { faPalette, faXmark, faCheck } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../lib/api";
import { setViewerTheme, viewerThemeId } from "../../lib/viewerTheme";
import "./ThemeChooserBlock.scss";

interface InstalledTheme {
  id: string;
  name: string;
  version: string;
  active: boolean;
  description: string | null;
  screenshot: string | null;
}

export function ThemeChooser() {
  const { t } = useTranslation();
  const [themes, setThemes] = useState<InstalledTheme[] | null>(null);
  const [open, setOpen] = useState(false);
  const chosen = viewerThemeId();

  useEffect(() => {
    let alive = true;
    api.get<{ themes: InstalledTheme[] }>("/themes/choices")
      .then((r) => { if (alive) setThemes(r.themes); })
      // A site that cannot answer simply has no chooser. This is a footer control,
      // not something worth an error message in front of a reader.
      .catch(() => { if (alive) setThemes([]); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Nothing to choose BETWEEN is not a choice: one installed theme means the site's
  // own, and an icon that opens a dialog with one card in it is furniture.
  if (!themes || themes.length < 2) return null;

  const siteTheme = themes.find((x) => x.active);
  /** What is being worn: the reader's pick, or the site's own when they have none. */
  const wearing = chosen ?? siteTheme?.id ?? "";

  const choose = (id: string | null) => {
    setViewerTheme(id);
    window.location.reload();
  };

  return (
    <>
      <button
        type="button"
        className="nv-themepick__open"
        aria-haspopup="dialog"
        title={t("themeChooser.open", { defaultValue: "Choose a theme" })}
        aria-label={t("themeChooser.open", { defaultValue: "Choose a theme" })}
        onClick={() => setOpen(true)}
      >
        <FontAwesomeIcon icon={faPalette} />
      </button>

      {open && (
        <div className="nv-themedlg" onClick={() => setOpen(false)}>
          <div
            className="nv-themedlg__panel"
            role="dialog"
            aria-modal="true"
            aria-label={t("themeChooser.title", { defaultValue: "Themes" })}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="nv-themedlg__head">
              <div>
                <h2>{t("themeChooser.title", { defaultValue: "Themes" })}</h2>
                <p>{t("themeChooser.note", {
                  defaultValue: "Your choice, on this device. It changes nothing for anyone else.",
                })}</p>
              </div>
              <button type="button" className="nv-themedlg__x"
                onClick={() => setOpen(false)}
                title={t("themeChooser.close", { defaultValue: "Close" })}
                aria-label={t("themeChooser.close", { defaultValue: "Close" })}>
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            <div className="nv-themedlg__list">
              {themes.map((theme) => {
                const worn = theme.id === wearing;
                return (
                  <button
                    key={theme.id}
                    type="button"
                    className={`nv-themecard${worn ? " is-worn" : ""}`}
                    aria-current={worn}
                    // ⚠ The SITE's theme clears the cookie rather than storing its id.
                    // Storing it would pin the reader to today's active theme, and
                    // they would go on wearing it after the admin switched — having
                    // chosen "the site's theme", which is the one thing that then
                    // would not follow the site.
                    onClick={() => choose(theme.active ? null : theme.id)}
                  >
                    <span className="nv-themecard__shot">
                      {theme.screenshot
                        ? <img src={theme.screenshot} alt="" loading="lazy" />
                        : <span className="nv-themecard__noshot"><FontAwesomeIcon icon={faPalette} /></span>}
                    </span>
                    <span className="nv-themecard__body">
                      <span className="nv-themecard__name">
                        {theme.name}
                        {/* TWO different facts, and a reader can be looking at either.
                            "Active" is what THIS READER is wearing; "Site" is what the
                            admin chose for everyone. They coincide until the reader
                            picks something else, which is exactly when telling them
                            apart starts to matter. */}
                        {worn && (
                          <span className="nv-themecard__badge nv-themecard__badge--active">
                            {t("themeChooser.activeBadge", { defaultValue: "Active" })}
                          </span>
                        )}
                        {theme.active && (
                          <span className="nv-themecard__badge">
                            {t("themeChooser.siteBadge", { defaultValue: "Site" })}
                          </span>
                        )}
                      </span>
                      {/* Omitted rather than filled with the theme's own name back at
                          the reader: a theme without a description has nothing to say
                          about itself, and the thumbnail is doing the work anyway. */}
                      {theme.description && (
                        <span className="nv-themecard__desc">{theme.description}</span>
                      )}
                    </span>
                    {/* The tick sits at the END of the row rather than over the
                        thumbnail — at this size it would cover most of the picture. */}
                    {worn && (
                      <span className="nv-themecard__worn" title={t("themeChooser.inUse", { defaultValue: "In use" })}>
                        <FontAwesomeIcon icon={faCheck} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

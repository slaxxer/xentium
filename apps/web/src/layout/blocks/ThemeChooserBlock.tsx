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
 *
 * COLOURWAYS: a theme that ships more than one (Vanguard's four accents) gets a row of
 * chips under its card. On the theme being worn a chip recolours in place — only the
 * stylesheet changes, so there is nothing to reload for. On another theme it switches
 * to that theme in that colourway, which reloads like any theme switch.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "../../components/Icon";
import { faPalette, faXmark, faCheck } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../lib/api";
import { setViewerColourway, setViewerTheme, viewerColourwayId, viewerThemeId } from "../../lib/viewerTheme";
import { refreshTokenCss } from "../../lib/liveStyle";
import "./ThemeChooserBlock.scss";

interface ThemeColourway {
  id: string;
  name: string;
  /** Background, accent, second accent — whichever the colourway sets. */
  swatch: string[];
}

interface InstalledTheme {
  id: string;
  name: string;
  version: string;
  active: boolean;
  description: string | null;
  screenshot: string | null;
  colourways?: ThemeColourway[];
  /** The colourway the theme wears with no pick from the visitor, if it matches one. */
  wornColourway?: string | null;
}

export function ThemeChooser() {
  const { t } = useTranslation();
  const [themes, setThemes] = useState<InstalledTheme[] | null>(null);
  const [open, setOpen] = useState(false);
  const chosen = viewerThemeId();
  // State, not a read per render: picking a colourway on the worn theme does not
  // reload, so the chips have to learn about it from here.
  const [pickedCw, setPickedCw] = useState(viewerColourwayId);

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

  // Nothing to choose BETWEEN is not a choice: one installed theme with one look means
  // the site's own, and an icon that opens a dialog with one card in it is furniture.
  // One theme with several colourways IS a choice.
  if (!themes) return null;
  if (themes.length < 2 && !themes.some((x) => (x.colourways?.length ?? 0) > 1)) return null;

  const siteTheme = themes.find((x) => x.active);
  /** What is being worn: the reader's pick, or the site's own when they have none. */
  const wearing = chosen ?? siteTheme?.id ?? "";

  // ⚠ The SITE's theme clears the cookie rather than storing its id. Storing it would
  // pin the reader to today's active theme, and they would go on wearing it after the
  // admin switched — having chosen "the site's theme", which is the one thing that
  // then would not follow the site.
  const cookieFor = (theme: InstalledTheme) => (theme.active ? null : theme.id);

  const choose = (theme: InstalledTheme) => {
    setViewerTheme(cookieFor(theme));
    window.location.reload();
  };

  /**
   * Wear `theme` in colourway `cw`.
   *
   * Picking the colourway the theme already wears CLEARS the choice instead of storing
   * it, for the same reason as the site's theme above: the reader then follows the
   * admin's colourway if it changes, rather than being frozen on today's.
   */
  const chooseColourway = (theme: InstalledTheme, cw: string) => {
    const next = cw === theme.wornColourway ? null : cw;
    if (theme.id === wearing) {
      setViewerColourway(next);
      setPickedCw(next);
      void refreshTokenCss();
      return;
    }
    setViewerTheme(cookieFor(theme));
    setViewerColourway(next);
    window.location.reload();
  };

  return (
    <>
      <button
        type="button"
        className="xt-themepick__open"
        aria-haspopup="dialog"
        title={t("themeChooser.open", { defaultValue: "Choose a theme" })}
        aria-label={t("themeChooser.open", { defaultValue: "Choose a theme" })}
        onClick={() => setOpen(true)}
      >
        <FontAwesomeIcon icon={faPalette} />
      </button>

      {open && (
        <div className="xt-themedlg" onClick={() => setOpen(false)}>
          <div
            className="xt-themedlg__panel"
            role="dialog"
            aria-modal="true"
            aria-label={t("themeChooser.title", { defaultValue: "Themes" })}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="xt-themedlg__head">
              <h2>{t("themeChooser.title", { defaultValue: "Themes" })}</h2>
              <button type="button" className="xt-themedlg__x"
                onClick={() => setOpen(false)}
                title={t("themeChooser.close", { defaultValue: "Close" })}
                aria-label={t("themeChooser.close", { defaultValue: "Close" })}>
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            <div className="xt-themedlg__list">
              {themes.map((theme) => {
                const worn = theme.id === wearing;
                const colourways = theme.colourways ?? [];
                // Only the worn theme has a colourway in use. The reader's pick, else
                // the one the theme wears on its own.
                const wornCw = worn ? (pickedCw && colourways.some((c) => c.id === pickedCw)
                  ? pickedCw : theme.wornColourway ?? null) : null;
                return (
                  <div key={theme.id} className={`xt-themeopt${worn ? " is-worn" : ""}`}>
                  <button
                    type="button"
                    className={`xt-themecard${worn ? " is-worn" : ""}`}
                    aria-current={worn}
                    onClick={() => choose(theme)}
                  >
                    <span className="xt-themecard__shot">
                      {theme.screenshot
                        ? <img src={theme.screenshot} alt="" loading="lazy" />
                        : <span className="xt-themecard__noshot"><FontAwesomeIcon icon={faPalette} /></span>}
                    </span>
                    <span className="xt-themecard__body">
                      <span className="xt-themecard__name">
                        {theme.name}
                        {/* No "Active" / "Site" badges: the tick at the end of the row
                            already says which theme is in use. */}
                      </span>
                      {/* Omitted rather than filled with the theme's own name back at
                          the reader: a theme without a description has nothing to say
                          about itself, and the thumbnail is doing the work anyway. */}
                      {theme.description && (
                        <span className="xt-themecard__desc">{theme.description}</span>
                      )}
                    </span>
                    {/* The tick sits at the END of the row rather than over the
                        thumbnail — at this size it would cover most of the picture. */}
                    {worn && (
                      <span className="xt-themecard__worn" title={t("themeChooser.inUse", { defaultValue: "In use" })}>
                        <FontAwesomeIcon icon={faCheck} />
                      </span>
                    )}
                  </button>
                  {colourways.length > 1 && (
                    <div className="xt-themecw" role="radiogroup"
                      aria-label={t("themeChooser.colourways", { defaultValue: "{{theme}} colourways", theme: theme.name })}>
                      {colourways.map((cw) => {
                        const on = cw.id === wornCw;
                        const [bg, ...accents] = cw.swatch;
                        return (
                          <button key={cw.id} type="button" role="radio" aria-checked={on}
                            className={`xt-themecw__chip${on ? " is-on" : ""}`}
                            onClick={() => chooseColourway(theme, cw.id)}>
                            {/* The colourway's own colours, as data — the dot IS the preview. */}
                            <span className="xt-themecw__dot" style={{ background: bg }} aria-hidden>
                              {accents.map((c, i) => <span key={i} style={{ background: c }} />)}
                            </span>
                            {cw.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

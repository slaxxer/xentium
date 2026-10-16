import { useTranslation } from "react-i18next";
import { useEffect, useRef } from "react";
import { previewThemeKey } from "../lib/editingTheme";
import { PubNav } from "../layouts/PubNav";
import { SiteFooter } from "../layouts/SiteFooter";
import { loadTokenCss, startStyleSync } from "../lib/liveStyle";
import "../layouts/AppLayout.scss";
import "./ThemePreview.scss";

/**
 * /__theme-preview — ADR-0003 Phase 2 specimen route.
 *
 * Renders the *real* PubNav + a deterministic specimen of every component/region
 * surface + the *real* SiteFooter, so the Style Editor (Phase 3) can load it in an
 * iframe and use it as a spatial selector: click a surface → read the nearest
 * `data-region` / `data-component` / `data-group` to know which token group to edit.
 *
 * Clicks are suppressed in the capture phase so the specimen never navigates or
 * mutates anything — links and buttons are inert here. The one exception is a
 * dropdown TRIGGER (`button[aria-expanded]`): the header's dropdowns open, so the
 * editor can select and style them. The editor
 * adds its own selection listener on top (Phase 3); suppression only blocks the
 * default actions, it does not block reading the event target.
 *
 * The page also applies the live appearance token CSS (same as AppLayout) so edits
 * are reflected without a reload while the editor is open.
 */
export function ThemePreview() {
  const { t } = useTranslation("common");
  const rootRef = useRef<HTMLDivElement>(null);

  // Mirror AppLayout: inject the saved token overrides and keep them live-synced.
  useEffect(() => {
    // Editing a theme that is not the live one: start from THAT theme's stylesheet,
    // or the editor's draft paints over another theme's custom CSS.
    void loadTokenCss({ draft: previewThemeKey() !== null });
    startStyleSync();
  }, []);

  // Capture-phase click suppression — the specimen is inert.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const suppress = (e: MouseEvent) => {
      // A dropdown's own trigger is let through, so the header's dropdowns open here
      // and can be clicked and styled. Only the trigger: what is INSIDE an open
      // dropdown (links, mark-read, mod actions) stays inert like everything else.
      const t = e.target as Element | null;
      if (t?.closest?.("button[aria-expanded]") && !t.closest(".xt-pop")) return;
      e.preventDefault();
      e.stopPropagation();
    };
    el.addEventListener("click", suppress, true);
    return () => el.removeEventListener("click", suppress, true);
  }, []);

  return (
    <div className="app-layout" ref={rootRef} data-theme-preview>
      {/* Region: navbar — the real nav */}
      <div data-region="navbar" data-group="navbar">
        <PubNav />
      </div>

      {/* Region: content (scope root = .app-main) */}
      <main className="app-main tp-main" data-region="content" data-group="content">
        {/* Aside rail. Region theming is token-based (`--aside-bg`), so this needs no
            borrowed class — `.tp-rail` styles itself. */}
        <aside className="tp-rail" data-region="aside" data-group="aside">
          <span className="tp-rail__h">{t("themePreview.aside")}</span>
          <span className="tp-rail__row">{t("themePreview.sidebarSurface")}</span>
          <span className="tp-rail__row">{t("themePreview.sidePanels")}</span>
        </aside>

        <div className="tp-content">
          {/* Buttons */}
          <section>
            <h2 className="tp-sec__title">{t("themePreview.buttons")}</h2>
            <div className="tp-row">
              <button type="button" className="btn-primary" data-component="button" data-group="button">{t("themePreview.primary")}</button>
              <button type="button" className="btn-ghost"   data-component="button" data-group="button">{t("themePreview.ghost")}</button>
              <button type="button" className="btn-danger"  data-component="button" data-group="button">{t("themePreview.danger")}</button>
            </div>
          </section>

          {/* Cards */}
          <section>
            <h2 className="tp-sec__title">{t("themePreview.cards")}</h2>
            <div className="tp-row">
              <div className="tp-card" data-component="card" data-group="card">
                <div className="tp-card__h">{t("themePreview.cardTitle")}</div>
                <p className="tp-card__p">{t("themePreview.cardBody")}</p>
              </div>
              <div className="tp-card" data-component="card" data-group="card">
                <div className="tp-card__h">{t("themePreview.secondCard")}</div>
                <p className="tp-card__p">{t("themePreview.secondCardBody")}</p>
              </div>
            </div>
          </section>

          {/* Fields */}
          <section>
            <h2 className="tp-sec__title">{t("themePreview.fields")}</h2>
            <div className="tp-fields">
              <input className="tp-field" type="text" placeholder={t("themePreview.textInput")} defaultValue={t("themePreview.specimenValue")} data-component="field" data-group="field" />
              <select className="tp-field" data-component="field" data-group="field" defaultValue="b">
                <option value="a">{t("themePreview.firstOption")}</option>
                <option value="b">{t("themePreview.secondOption")}</option>
              </select>
              <textarea className="tp-field" rows={3} defaultValue={t("themePreview.specimenMultiline")} data-component="field" data-group="field" />
            </div>
          </section>

          {/* Menu — statically open */}
          <section>
            <h2 className="tp-sec__title">{t("themePreview.menu")}</h2>
            <div className="tp-menu" data-component="menu" data-group="menu">
              <button type="button" className="tp-menu__item">{t("themePreview.menuItem")}</button>
              <button type="button" className="tp-menu__item">{t("themePreview.anotherItem")}</button>
              <button type="button" className="tp-menu__item">{t("themePreview.hoverMe")}</button>
            </div>
          </section>

          {/* Sort / segment buttons */}
          <section>
            <h2 className="tp-sec__title">{t("themePreview.sortButtons")}</h2>
            <div className="tp-seg" data-component="segment" data-group="segment">
              <button type="button" className="tp-seg__btn is-on">{t("themePreview.active")}</button>
              <button type="button" className="tp-seg__btn">{t("themePreview.newest")}</button>
              <button type="button" className="tp-seg__btn">A–Z</button>
            </div>
          </section>
        </div>
      </main>

      {/* Region: footer — the real footer */}
      <div data-region="footer" data-group="footer">
        <SiteFooter />
      </div>
    </div>
  );
}

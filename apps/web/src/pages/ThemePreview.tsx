import { useEffect, useRef } from "react";
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
 * mutates anything — links, buttons and the nav dropdown are inert here. The editor
 * adds its own selection listener on top (Phase 3); suppression only blocks the
 * default actions, it does not block reading the event target.
 *
 * The page also applies the live appearance token CSS (same as AppLayout) so edits
 * are reflected without a reload while the editor is open.
 */
export function ThemePreview() {
  const rootRef = useRef<HTMLDivElement>(null);

  // Mirror AppLayout: inject the saved token overrides and keep them live-synced.
  useEffect(() => {
    void loadTokenCss();
    startStyleSync();
  }, []);

  // Capture-phase click suppression — the specimen is inert.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const suppress = (e: MouseEvent) => {
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
          <span className="tp-rail__h">Aside</span>
          <span className="tp-rail__row">Sidebar surface</span>
          <span className="tp-rail__row">Rails &amp; side panels</span>
        </aside>

        <div className="tp-content">
          {/* Buttons */}
          <section>
            <h2 className="tp-sec__title">Buttons</h2>
            <div className="tp-row">
              <button type="button" className="btn-primary" data-component="button" data-group="button">Primary</button>
              <button type="button" className="btn-ghost"   data-component="button" data-group="button">Ghost</button>
              <button type="button" className="btn-danger"  data-component="button" data-group="button">Danger</button>
            </div>
          </section>

          {/* Cards */}
          <section>
            <h2 className="tp-sec__title">Cards</h2>
            <div className="tp-row">
              <div className="tp-card" data-component="card" data-group="card">
                <div className="tp-card__h">Card title</div>
                <p className="tp-card__p">Background, border, radius and shadow all read from the card token group.</p>
              </div>
              <div className="tp-card" data-component="card" data-group="card">
                <div className="tp-card__h">Second card</div>
                <p className="tp-card__p">Two cards so spacing and elevation are easy to judge while editing.</p>
              </div>
            </div>
          </section>

          {/* Fields */}
          <section>
            <h2 className="tp-sec__title">Fields</h2>
            <div className="tp-fields">
              <input className="tp-field" type="text" placeholder="Text input" defaultValue="Specimen value" data-component="field" data-group="field" />
              <select className="tp-field" data-component="field" data-group="field" defaultValue="b">
                <option value="a">First option</option>
                <option value="b">Second option</option>
              </select>
              <textarea className="tp-field" rows={3} defaultValue="Multi-line field specimen." data-component="field" data-group="field" />
            </div>
          </section>

          {/* Menu — statically open */}
          <section>
            <h2 className="tp-sec__title">Menu</h2>
            <div className="tp-menu" data-component="menu" data-group="menu">
              <button type="button" className="tp-menu__item">Menu item</button>
              <button type="button" className="tp-menu__item">Another item</button>
              <button type="button" className="tp-menu__item">Hover me</button>
            </div>
          </section>

          {/* Sort / segment buttons */}
          <section>
            <h2 className="tp-sec__title">Sort buttons</h2>
            <div className="tp-seg" data-component="segment" data-group="segment">
              <button type="button" className="tp-seg__btn is-on">Active</button>
              <button type="button" className="tp-seg__btn">Newest</button>
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

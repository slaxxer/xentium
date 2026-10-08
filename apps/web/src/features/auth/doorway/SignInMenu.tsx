import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { faRightToBracket, faWandMagicSparkles } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../../components/Icon";
import { useRegistrationStatus } from "../../../hooks/useRegistrationStatus";
import { useAuthMethods, useDoorwayStats } from "./AuthDoorway";
import { SignInForm } from "./SignInForm";
import "./Doorway.scss";

/** How far the panel keeps from the window's edges, and its width where there is room. */
const GUTTER = 12;
const WIDTH = 340;

/**
 * The header's "Sign in": a compact form that opens under the button, so a visitor
 * signs in WHERE THEY ARE. Register still goes to the full page; so do the longer
 * flows (a sign-in link, a forgotten password).
 *
 * The panel is portalled to <body> and placed by the button's rectangle. Inside the
 * masthead's action pill it would inherit the pill's redefined colour tokens and its
 * stacking context — exactly what the account menu has to fight — and on a phone it
 * would be clipped by the band.
 */
export function SignInMenu({ className }: { className: string }) {
  const { t } = useTranslation("auth");
  const location = useLocation();
  const navigate = useNavigate();
  const { data: stats } = useDoorwayStats();
  const { data: methods } = useAuthMethods();
  const { open: registrationOpen } = useRegistrationStatus();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; arrow: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const here = `${location.pathname}${location.search}`;

  const place = useCallback(() => {
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(WIDTH, window.innerWidth - GUTTER * 2);
    // Right edges line up with the button, as far as the window allows.
    const left = Math.max(GUTTER, Math.min(r.right - width, window.innerWidth - width - GUTTER));
    setPos({ top: r.bottom + 10, left, width, arrow: Math.min(width - 20, Math.max(20, r.left + r.width / 2 - left)) });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  // Moving to another page closes it.
  useEffect(() => { setOpen(false); }, [location.pathname]);

  return (
    <>
      <button ref={button} type="button" className={className} aria-haspopup="dialog" aria-expanded={open}
        aria-label={t("door.tabs.signIn")} title={t("door.tabs.signIn")}
        onClick={() => setOpen((v) => !v)}>
        <FontAwesomeIcon icon={faRightToBracket} />
      </button>
      {open && pos && createPortal(
        <div ref={panel} className="dw-pop" role="dialog" aria-label={t("door.menu.title", { site: stats?.siteName ?? "" })}
          style={{ top: pos.top, left: pos.left, width: pos.width, ["--dw-pop-arrow" as string]: `${pos.arrow}px` }}>
          <div className="dw-pop__body">
            <SignInForm
              compact
              head={{ title: t("door.menu.title", { site: stats?.siteName ?? "" }), sub: t("door.menu.sub") }}
              returnTo={here}
              onSignedIn={() => setOpen(false)}
            />
          </div>
          <div className="dw-pop__foot">
            {registrationOpen && (
              <span>{t("door.corner.new")} <Link to="/register" className="dw-link">{t("door.menu.create")}</Link></span>
            )}
            {methods?.magicLink && (
              <button type="button" className="dw-link" onClick={() => navigate(`/login?mode=link&returnTo=${encodeURIComponent(here)}`)}>
                <FontAwesomeIcon icon={faWandMagicSparkles} /> {t("door.menu.link")}
              </button>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

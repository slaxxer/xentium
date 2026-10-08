import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { faArrowLeft, faGlobe } from "@fortawesome/free-solid-svg-icons";
import { legalPath } from "@xentium/contracts";
import { FontAwesomeIcon } from "../../../components/Icon";
import { UserAvatar } from "../../../components/UserAvatar";
import { api } from "../../../lib/api";
import { useLegalLinks } from "../../../lib/legalApi";
import { SUPPORTED_LOCALES, setLocale, type LocaleCode } from "../../../lib/i18n";
import { useRegistrationStatus } from "../../../hooks/useRegistrationStatus";
import { useBranding } from "../../../hooks/useBranding";
import { SiteLogo } from "../../../components/SiteLogo";
import { useLayoutDocument } from "../../../layout/useLayout";
import { sectionBackground } from "../../../layout/blocks/sectionBackground";
import type { AuthMethods } from "./signInClient";
import "./Doorway.scss";

// The page people meet before they are members: sign in, create an account, get back
// in. A brand band across the top (the site's own masthead colours, so it reads as
// the site), the community's numbers on it, and one centred card with the form.
// Every screen of the flow renders inside this shell (see doorway/*Panel.tsx).
// Signing in from a page uses the masthead dropdown instead (SignInMenu); this page
// is where links, redirects and the longer flows land.

export interface DoorwayStats {
  siteName: string;
  tagline: string;
  members: number;
  online: number;
  joinedThisWeek: number;
  recent: Array<{ username: string; avatar: string | null }>;
}

/** Which sign-in methods this install offers. Buttons for anything else are never drawn. */
export function useAuthMethods() {
  return useQuery<AuthMethods>({
    queryKey: ["auth-methods"],
    queryFn: () => api.get("/auth/methods"),
    staleTime: 5 * 60_000,
  });
}

export function useDoorwayStats() {
  return useQuery<DoorwayStats>({
    queryKey: ["auth-doorway"],
    queryFn: () => api.get("/auth/doorway"),
    staleTime: 60_000,
  });
}

/** What the band's top-right corner offers: the other door, or the way back. */
export type DoorwayCorner = "signIn" | "register" | "home";

/**
 * The band wears the published masthead's background — its picture and gradient — so
 * whatever an admin gave the header, the doorway matches. A site with no masthead
 * band (or none with a background) falls back to the accent colours.
 */
function useBandBackground(): string | undefined {
  const doc = useLayoutDocument("chrome.header");
  const band = (doc.regions.header ?? []).find((b) => b.type === "header");
  return band ? sectionBackground(band.props as Parameters<typeof sectionBackground>[0]) : undefined;
}

export function AuthDoorway({ children, corner = "home" }: { children: ReactNode; corner?: DoorwayCorner }) {
  const { data } = useDoorwayStats();
  const background = useBandBackground();
  return (
    <div className="dw">
      <div className={`dw-band${background ? " dw-band--custom" : ""}`} style={background ? { backgroundImage: background } : undefined} aria-hidden />
      <header className="dw-top">
        <Brand siteName={data?.siteName} />
        <Corner kind={corner} />
      </header>
      {data && <StatsStrip data={data} />}
      <main className="dw-main">
        <div className="dw-card">{children}</div>
      </main>
      <Footer />
    </div>
  );
}

/** The site's own logo, as the header draws it: the uploaded image, or the Xentium mark and wordmark. */
function Brand({ siteName }: { siteName?: string }) {
  const { data: branding } = useBranding();
  return (
    <Link to="/" className="dw-brand">
      <SiteLogo size={36} imgClassName="dw-brand__img"
        wordmark={<span className="dw-brand__name">{branding?.logoText || siteName || "Xentium"}</span>} />
    </Link>
  );
}

function Corner({ kind }: { kind: DoorwayCorner }) {
  const { t } = useTranslation("auth");
  const { open } = useRegistrationStatus();
  if (kind === "signIn") {
    return (
      <div className="dw-corner">
        <span>{t("door.corner.member")}</span>
        <Link to="/login" className="dw-corner__btn">{t("door.tabs.signIn")}</Link>
      </div>
    );
  }
  if (kind === "register" && open) {
    return (
      <div className="dw-corner">
        <span>{t("door.corner.new")}</span>
        <Link to="/register" className="dw-corner__btn">{t("door.tabs.register")}</Link>
      </div>
    );
  }
  return (
    <div className="dw-corner">
      <Link to="/" className="dw-corner__btn dw-corner__btn--quiet"><FontAwesomeIcon icon={faArrowLeft} /> {t("door.corner.home")}</Link>
    </div>
  );
}

function StatsStrip({ data }: { data: DoorwayStats }) {
  const { t } = useTranslation("auth");
  const fmt = (n: number) => n.toLocaleString();
  const others = Math.max(0, data.joinedThisWeek - Math.min(2, data.recent.length));
  return (
    <div className="dw-strip">
      <span className="dw-strip__item"><span className="dw-live" aria-hidden /><b>{fmt(data.online)}</b> {t("door.side.online")}</span>
      <span className="dw-strip__item"><b>{fmt(data.members)}</b> {t("door.side.members", { count: data.members })}</span>
      {data.recent.length > 0 && (
        <span className="dw-strip__item dw-strip__item--people">
          <span className="dw-faces">
            {data.recent.slice(0, 3).map((u) => <UserAvatar key={u.username} user={u} size={20} />)}
          </span>
          <span>
            {others > 0
              ? t("door.side.joinedMany", { a: data.recent[0]!.username, b: data.recent[1]?.username ?? "", count: others })
              : data.recent.length > 1
                ? t("door.side.joinedTwo", { a: data.recent[0]!.username, b: data.recent[1]!.username })
                : t("door.side.joinedOne", { a: data.recent[0]!.username })}
          </span>
        </span>
      )}
    </div>
  );
}

function Footer() {
  const { t: tc } = useTranslation("common");
  const legal = useLegalLinks();
  return (
    <footer className="dw-foot">
      <LocaleMenu />
      {legal.map((d) => <Link key={d.key} to={legalPath(d.key)}>{tc(`legal.link.${d.key}`)}</Link>)}
    </footer>
  );
}

function LocaleMenu() {
  const { i18n, t } = useTranslation("auth");
  return (
    <label className="dw-locale">
      <FontAwesomeIcon icon={faGlobe} />
      <span className="dw-sr">{t("door.language")}</span>
      <select value={i18n.resolvedLanguage ?? i18n.language} onChange={(e) => setLocale(e.target.value as LocaleCode)}>
        {SUPPORTED_LOCALES.map((l) => <option key={l.code} value={l.code}>{l.native}</option>)}
      </select>
    </label>
  );
}

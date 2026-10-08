import type { ReactNode } from "react";
import { useBranding } from "../hooks/useBranding";
import { XentiumMark } from "./XentiumMark";

/**
 * The site's logo wherever a page names the site: the admin's uploaded logo, or — the
 * default every install ships with — the Xentium mark followed by the wordmark.
 * An uploaded logo usually carries its own name, so it stands alone.
 *
 * Both wear `.xt-logo-fx`, the border and shadow from Theme Studio → Colours → Logo icon.
 */
export function SiteLogo({ size = 32, wordmark, imgClassName = "", markClassName = "" }: {
  size?: number;
  /** Shown beside the default mark only. */
  wordmark?: ReactNode;
  imgClassName?: string;
  markClassName?: string;
}) {
  const { data: branding } = useBranding();
  if (branding?.navbarUrl) {
    return <img className={`xt-logo-fx ${imgClassName}`} src={branding.navbarUrl} alt={branding.logoText ?? "Home"} />;
  }
  return (
    <>
      <XentiumMark size={size} className={`xt-logo-fx ${markClassName}`} />
      {wordmark}
    </>
  );
}

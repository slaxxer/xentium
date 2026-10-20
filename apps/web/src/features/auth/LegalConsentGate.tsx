import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { legalPath, type LegalDocumentKey } from "@xentium/contracts";
import { useAuth } from "../../hooks/useAuth";

/**
 * A member who still has to accept a legal document goes to that document, and
 * stays there until they have: every other page sends them back. The server says
 * which (`pendingLegal` on /auth/me): a document members must accept that they
 * never have (imported, or made by an admin or a sign-in provider), or one the
 * admin asked their group to accept again. The document's page carries the
 * checkbox (LegalPage → LegalAcceptBox); accepting the last one lets them go on,
 * back to where they were headed.
 */
const RETURN_KEY = "xt.legal.return";

/** Where to go once everything is accepted. */
export function takeLegalReturnPath(): string {
  try {
    const p = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    return p && p.startsWith("/") && !p.startsWith("/legal/") ? p : "/";
  } catch { return "/"; }
}

export function LegalConsentGate() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const next: LegalDocumentKey | undefined = user?.pendingLegal?.[0];

  useEffect(() => {
    if (!next) return;
    const target = legalPath(next);
    if (location.pathname === target) return;
    // Remember the first page they were headed to, not each bounce.
    try {
      if (!location.pathname.startsWith("/legal/") && !sessionStorage.getItem(RETURN_KEY)) {
        sessionStorage.setItem(RETURN_KEY, location.pathname + location.search);
      }
    } catch { /* no storage: they land on the home page afterwards */ }
    navigate(target, { replace: true });
  }, [next, location.pathname, location.search, navigate]);

  return null;
}

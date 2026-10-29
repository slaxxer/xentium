import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../hooks/useAuth";
import { openDialog } from "../../lib/dialog";

const LATER_KEY = "xt.2fa.later";

/**
 * An account that must use two-factor sign-in (ACP → Permissions, "Must use
 * two-factor sign-in") and has not turned it on is asked to, once per browser
 * session, on any page but its own account page. Someone just given a staff
 * group has no reason to open the ACP and find it closed; this tells them first.
 * The ACP itself shows its own screen instead (AcpAuthGate), so not there either.
 */
export function TwoFactorPrompt() {
  const { t } = useTranslation("auth");
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const due = !!user?.twoFactor?.required && !user.twoFactor.enabled && !user.needsLegalConsent;
  const here = location.pathname.startsWith("/account") || location.pathname.startsWith("/admin");

  useEffect(() => {
    if (!due || here) return;
    try { if (sessionStorage.getItem(LATER_KEY) === "1") return; } catch { /* private mode: ask anyway */ }
    void openDialog({
      kind: "confirm", icon: "warning",
      title: t("twoFactorPrompt.title"),
      body: t("twoFactorPrompt.body"),
      confirmText: t("twoFactorPrompt.action"),
      cancelText: t("twoFactorPrompt.later"),
    }).then((go) => {
      try { sessionStorage.setItem(LATER_KEY, "1"); } catch { /* it just asks again */ }
      if (go) navigate("/account?tab=security");
    });
  }, [due, here, t, navigate]);

  return null;
}

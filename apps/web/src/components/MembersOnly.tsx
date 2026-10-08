import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

/**
 * A page only members may open. A guest is sent to sign in and brought back here
 * afterwards (`returnTo`). While the session is still being restored — the access
 * token lives in memory, so it is absent on first paint — nothing renders: deciding
 * then would bounce a signed-in member to the sign-in page on every reload.
 */
export function MembersOnly({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const { pathname, search } = useLocation();
  if (isLoading) return null;
  if (!isAuthenticated) return <Navigate to={`/login?returnTo=${encodeURIComponent(pathname + search)}`} replace />;
  return <>{children}</>;
}

/**
 * A header widget (a plugin's bell, messages, …) — for signed-in members only, as the
 * slot contract promises (`HeaderWidgetSlot`). EVERY place that draws one goes
 * through this: the masthead's cluster, the widget's own block, and the navbar while
 * the masthead is hidden. A guest seeing a member's inbox button was the bug.
 */
export function MemberWidget({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <>{children}</> : null;
}

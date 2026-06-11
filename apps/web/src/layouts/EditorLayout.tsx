import { Navigate, Outlet, useLocation } from "react-router-dom";
import { PubNav } from "./PubNav";
import { useAuth } from "../hooks/useAuth";
import "./AppLayout.scss";
import "./EditorLayout.scss";

/** Full-viewport editor frame: PubNav + child fills the rest. No main / footer.
 *  Auth-gated — guests get bounced to /login with a returnTo query param. */
export function EditorLayout() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div
        style={{
          display: "flex",
          minHeight: "100dvh",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--c-fg-muted)",
        }}
      >
        Loading…
      </div>
    );
  }

  if (!isAuthenticated) {
    const returnTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?returnTo=${returnTo}`} replace />;
  }

  return (
    <div className="editor-layout">
      <PubNav />
      <Outlet />
    </div>
  );
}

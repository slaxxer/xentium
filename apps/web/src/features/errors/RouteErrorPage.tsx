import { useMemo } from "react";
import { isRouteErrorResponse, useLocation, useNavigate, useRouteError } from "react-router-dom";
import { ErrorScreen } from "./ErrorScreen";
import { NotFoundPage } from "../pages/NotFoundPage";
import { describeError, logClientError } from "../../lib/clientErrors";

/**
 * The router's `errorElement`. Replaces react-router's built-in "Hey developer 👋"
 * screen, which leaks framework internals to visitors and offers them nothing to
 * do about it.
 *
 * A 404 response is not an application error — hand it to the real 404 page so
 * a bad URL keeps looking like a bad URL.
 */
export function RouteErrorPage() {
  const error    = useRouteError();
  const navigate = useNavigate();
  const location = useLocation();

  const isResponse = isRouteErrorResponse(error);
  const isNotFound = isResponse && error.status === 404;

  // Memoised on the error identity: the report carries a reference id, and it
  // must not change under the user while they are copying it.
  const report = useMemo(
    () => {
      const r = isResponse
        ? describeError(error.data ?? error.statusText, { status: error.status, statusText: error.statusText })
        : describeError(error);
      logClientError(r, error);
      return r;
    },
    [error, isResponse],
  );

  if (isNotFound) return <NotFoundPage />;

  return (
    <ErrorScreen
      report={report}
      variant="full"
      // A fresh location key clears the router's error state, so this retries
      // the same URL without a document reload.
      onRetry={() => navigate(location.pathname + location.search, { replace: true })}
    />
  );
}

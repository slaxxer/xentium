import { Component, type ErrorInfo, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { ErrorScreen } from "./ErrorScreen";
import { describeError, logClientError, type ClientErrorReport } from "../../lib/clientErrors";

interface Props {
  children:  ReactNode;
  variant?:  "full" | "inline";
  /** Changing this clears a caught error — pass the route key so navigating
   *  away from a broken page is enough to recover. */
  resetKey?: string;
}

interface State {
  error:    unknown;
  report:   ClientErrorReport | null;
  resetKey: string | undefined;
}

/**
 * The app's render-crash net. React unmounts the whole tree under a component
 * that throws, so without one of these anywhere in the tree the user gets a
 * white page — or, under react-router, its developer-facing default screen.
 *
 * Place it where something useful survives: around a layout's `<Outlet />` the
 * nav and footer stay usable (`inline`), at the app root there is nothing left
 * to keep, so the screen takes over (`full`).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, report: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    // Built here rather than in componentDidCatch so the first fallback render
    // already has a report — componentDidCatch only adds the component stack.
    return { error, report: describeError(error) };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.resetKey) {
      return { error: null, report: null, resetKey: props.resetKey };
    }
    return null;
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const report = this.state.report ?? describeError(error);
    // Keep the reference stable: enrich the existing report, never replace it.
    this.setState({ report: { ...report, componentStack: info.componentStack ?? undefined } });
    logClientError(report, error);
  }

  private reset = () => this.setState({ error: null, report: null });

  render() {
    const { report } = this.state;
    if (!report) return this.props.children;
    return <ErrorScreen report={report} variant={this.props.variant ?? "full"} onRetry={this.reset} />;
  }
}

/**
 * Route-aware boundary: the same net, but a navigation clears it, so a user who
 * crashed one page can simply click elsewhere and carry on.
 */
export function RouteErrorBoundary({ children, variant }: Omit<Props, "resetKey">) {
  const location = useLocation();
  return (
    <ErrorBoundary resetKey={location.key} variant={variant}>
      {children}
    </ErrorBoundary>
  );
}

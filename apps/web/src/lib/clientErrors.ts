/**
 * Client-side crash description.
 *
 * Everything that can take a page down in the browser — a render crash, a
 * failed route, a bundle that no longer exists after a deploy — is normalised
 * here into one shape so the error screen has a single thing to render and the
 * user has a single thing to copy and hand to an admin.
 *
 * Deliberately framework-free: react-router's `ErrorResponse` is unwrapped by
 * the caller (RouteErrorPage) and passed in as `status`/`statusText`, so this
 * module stays usable from a plain class boundary and from tests.
 */

export type ErrorKind =
  /** A component threw while rendering. */
  | "crash"
  /** A JS/CSS chunk failed to load — almost always a deploy under an open tab. */
  | "chunk"
  /** A route/loader answered with an HTTP status (403, 500, …). */
  | "http";

export interface ClientErrorReport {
  kind:            ErrorKind;
  /** Short quotable id for this incident, e.g. `XT-M7K2P1-4QF`. */
  reference:       string;
  message:         string;
  status?:         number;
  /** XEC code when the API supplied one (`{ error: { code } }`). */
  code?:           string;
  stack?:          string;
  componentStack?: string;
  route:           string;
  at:              number;
}

/** Vite/browser wording for "the bundle you asked for isn't there any more". */
const CHUNK_RE =
  /(dynamically imported module|module script failed|ChunkLoadError|Loading chunk \S+ failed|Unable to preload CSS|Failed to fetch dynamically imported module)/i;

const RAND = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O/1/I — this gets read aloud

function makeReference(): string {
  let tail = "";
  for (let i = 0; i < 3; i++) tail += RAND[Math.floor(Math.random() * RAND.length)];
  return `XT-${Date.now().toString(36).toUpperCase()}-${tail}`;
}

/** Best-effort message extraction from anything a `throw` can carry. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const m = (error as { message?: unknown }).message;
    if (typeof m === "string" && m) return m;
    try { return JSON.stringify(error); } catch { /* circular */ }
  }
  return "Unknown error";
}

export interface DescribeOptions {
  componentStack?: string | null;
  /** Set by RouteErrorPage when react-router hands us an ErrorResponse. */
  status?:         number;
  statusText?:     string;
}

export function describeError(error: unknown, opts: DescribeOptions = {}): ClientErrorReport {
  const message = opts.status && !opts.statusText && !(error instanceof Error)
    ? `HTTP ${opts.status}`
    : messageOf(error);

  // The api client attaches `status` + the canonical `{ error: { code } }` body
  // to the Error it throws, so an API failure that escapes a component still
  // reports its XEC code rather than "Failed to fetch".
  const status = opts.status ?? (error as { status?: number } | null)?.status;
  const code   = (error as { detail?: { error?: { code?: string } } } | null)?.detail?.error?.code;

  const kind: ErrorKind =
    CHUNK_RE.test(message)         ? "chunk"
    : typeof status === "number"   ? "http"
    : "crash";

  return {
    kind,
    reference:      makeReference(),
    message:        opts.statusText && opts.statusText !== message
                      ? `${opts.statusText} — ${message}`
                      : message,
    status,
    code,
    stack:          error instanceof Error ? error.stack : undefined,
    componentStack: opts.componentStack ?? undefined,
    route:          typeof window === "undefined" ? "" : window.location.pathname + window.location.search,
    at:             Date.now(),
  };
}

/**
 * The text the "Copy report" button puts on the clipboard. Plain text, not
 * JSON: it gets pasted into a support thread or an issue by a human, so it has
 * to survive being read by one.
 */
export function formatReport(r: ClientErrorReport): string {
  const lines = [
    `Xentium client error ${r.reference}`,
    `Time:    ${new Date(r.at).toISOString()}`,
    `Route:   ${r.route || "(unknown)"}`,
    `Kind:    ${r.kind}`,
  ];
  if (r.status) lines.push(`Status:  ${r.status}`);
  if (r.code)   lines.push(`Code:    ${r.code}`);
  lines.push(`Message: ${r.message}`);
  if (typeof navigator !== "undefined") lines.push(`Agent:   ${navigator.userAgent}`);
  if (r.stack)          lines.push("", "Stack:", r.stack.trim());
  if (r.componentStack) lines.push("", "Component stack:", r.componentStack.trim());
  return lines.join("\n");
}

/**
 * Log a crash to the console in a form that is actually greppable. Called from
 * the boundary — a blank screen with a silent console is the single worst
 * outcome, so this is worth the noise.
 */
export function logClientError(report: ClientErrorReport, error: unknown): void {
  console.error(`[xentium] ${report.reference} (${report.kind}) at ${report.route}:`, error);
}

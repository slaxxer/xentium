import { apiStream } from "./api";
import { openProgressDialog, type DialogIcon } from "./dialog";

/**
 * Runs a long admin operation that streams newline-delimited JSON progress, and
 * renders it in a progress dialog.
 *
 * The server contract (marketplace install and update both speak it): zero or
 * more `{phase, percent, message}` events, then exactly one terminal
 * `{done: true, ok, ...}`. Because the response streams, headers are already
 * sent by the time anything can fail — so failures arrive as a terminal event
 * with `ok: false` rather than an HTTP error status, and the dialog is the whole
 * feedback surface (no toast).
 *
 * Shared rather than copied: the buffer-splitting below is fiddly enough that
 * two divergent copies would eventually disagree about partial-chunk handling.
 */

export interface ProgressEvent {
  phase?: string;
  percent?: number;
  message?: string;
  done?: boolean;
  ok?: boolean;
  [k: string]: unknown;
}

export interface StreamedJobOptions {
  title: string;
  icon?: DialogIcon;
  /** First line shown before the server reports anything. */
  startMessage?: string;
  /** Render a phase event as dialog text. */
  phaseLabel: (phase: string | undefined, message: string | undefined) => string;
  /** Message shown when the terminal event reports ok. */
  successMessage: (final: ProgressEvent) => string;
  /** Message shown when it fails, or when the stream dies mid-flight. */
  failureMessage: (final: ProgressEvent | null, error?: unknown) => string;
}

export interface StreamedJobResult {
  ok: boolean;
  final: ProgressEvent | null;
}

export async function runStreamedJob(
  path: string,
  body: unknown,
  opts: StreamedJobOptions,
): Promise<StreamedJobResult> {
  const dlg = openProgressDialog({
    icon: opts.icon ?? "update",
    title: opts.title,
    message: opts.startMessage ?? "",
  });

  try {
    const res = await apiStream(path, body);
    if (!res.ok || !res.body) throw new Error(`http_${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let final: ProgressEvent | null = null;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // A chunk can split mid-line, so only consume up to the last newline and
      // keep the remainder buffered for the next read.
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let evt: ProgressEvent;
        try {
          evt = JSON.parse(line) as ProgressEvent;
        } catch {
          continue;   // a malformed line must not abort a running install
        }
        if (evt.done) { final = evt; continue; }
        dlg.update(evt.percent ?? 0, opts.phaseLabel(evt.phase, evt.message));
      }
    }

    if (final?.ok) {
      dlg.succeed(opts.successMessage(final));
      return { ok: true, final };
    }
    dlg.fail(opts.failureMessage(final));
    return { ok: false, final };
  } catch (err) {
    dlg.fail(opts.failureMessage(null, err));
    return { ok: false, final: null };
  }
}

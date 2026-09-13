// Legacy-named facade over Xentium's own feedback primitives (sweetalert2 is
// GONE): toasts → lib/toast.ts (<ToastHost/>), dialogs → lib/dialog.ts
// (<DialogHost/>). The swal* names are kept so ~100 core call sites and every
// plugin (which externalize this module to the host global) work unchanged.
// New code should import `toast` from lib/toast and `openDialog` from
// lib/dialog directly.
import i18n from "./i18n";
import { toast } from "./toast";
import { openDialog } from "./dialog";

/**
 * Resolve a user-facing message from an API error. Prefers a localized message
 * keyed by the NEC error code (errors namespace); otherwise falls back to the
 * server-provided message, then the caller's fallback. No caller changes needed —
 * any error with a known NEC code is translated automatically.
 */
export function apiErrorMessage(
  e: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  if (e == null) return fallback;
  const err = e as Record<string, unknown>;
  const detail = err?.detail as Record<string, unknown> | undefined;
  const errObj = detail?.error as Record<string, unknown> | undefined;
  const code = errObj?.code as string | undefined;
  const serverMsg =
    (errObj?.message as string) ??
    (detail?.message as string) ??
    (e as Error)?.message;

  if (code && i18n.exists(code, { ns: "errors" })) {
    return i18n.t(code, { ns: "errors" });
  }
  return serverMsg ?? fallback;
}

export function swalError(text: string, title = "Error") {
  return openDialog({ kind: "alert", icon: "error", title, body: text });
}

export async function swalConfirm(
  title: string,
  text: string,
  confirmText = "Yes",
  cancelText = "Cancel",
): Promise<boolean> {
  return openDialog({ kind: "confirm", icon: "question", title, body: text, confirmText, cancelText });
}

export function swalToast(
  text: string,
  icon: "success" | "error" | "warning" | "info" = "error",
) {
  return toast.emit(icon, text);
}

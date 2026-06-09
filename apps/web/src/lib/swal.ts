import Swal from "sweetalert2";
import i18n from "./i18n";

const base = {
  background: "var(--c-card)",
  color: "var(--c-fg)",
  confirmButtonColor: "var(--c-accent)",
};

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
  return Swal.fire({ ...base, icon: "error", title, text });
}

export async function swalConfirm(
  title: string,
  text: string,
  confirmText = "Yes",
  cancelText = "Cancel",
): Promise<boolean> {
  const result = await Swal.fire({
    ...base,
    icon: "question",
    title,
    text,
    showCancelButton: true,
    confirmButtonText: confirmText,
    cancelButtonText: cancelText,
  });
  return result.isConfirmed;
}

export function swalToast(
  text: string,
  icon: "success" | "error" | "warning" | "info" = "error",
) {
  return Swal.fire({
    ...base,
    toast: true,
    position: "top-end",
    icon,
    text,
    timer: 3500,
    timerProgressBar: true,
    showConfirmButton: false,
  });
}

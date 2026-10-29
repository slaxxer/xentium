/**
 * "Confirm with a code" — the browser half of the API's step-up check.
 *
 * Some ACP actions (handing out permissions, installing code, connecting the
 * marketplace) answer 403 XEC-AUTH-1075 when the account has two-factor sign-in
 * on and has not typed a code in the last few minutes. `lib/api.ts` then asks
 * here for a code, and repeats the request with it in `X-Xentium-OTP`. One prompt
 * at a time: a second request waiting for a code shares the first one's answer.
 */

export interface StepUpPrompt { id: number; error: string | null }

let active: StepUpPrompt | null = null;
let resolver: ((code: string | null) => void) | null = null;
let pending: Promise<string | null> | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export const subscribeStepUp = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const getStepUp = () => active;

/** Ask for a code. `error` says why the last one was refused. Resolves null on cancel. */
export function requestStepUpCode(error: string | null = null): Promise<string | null> {
  if (pending && active) {
    active = { ...active, error };
    notify();
    return pending;
  }
  active = { id: nextId++, error };
  pending = new Promise<string | null>((resolve) => { resolver = resolve; });
  notify();
  return pending;
}

export function resolveStepUp(code: string | null) {
  resolver?.(code);
  resolver = null;
  pending = null;
  active = null;
  notify();
}

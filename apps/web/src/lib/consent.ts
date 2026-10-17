/**
 * Consent: what the site stores on a visitor's device or loads from elsewhere, and
 * whether the visitor has agreed to it.
 *
 * Core owns the CONTRACT, a consent plugin owns the DIALOG. Two parts:
 *
 *  - A registry of DECLARATIONS. Core and every plugin declare the cookies, browser
 *    storage and third-party services they use (name, purpose, lifetime, provider,
 *    category). A consent plugin lists them in its dialog and its cookie policy, so
 *    the list is never written by hand and never goes stale.
 *  - One CHECK, `hasConsent(category)`. Anything optional asks it before it sets a
 *    cookie or loads a script. With no consent plugin, the answer is the safe one:
 *    `necessary` yes, everything else no. A consent plugin registers itself as the
 *    PROVIDER and answers from the visitor's own choice.
 *
 * GDPR and the ePrivacy rules (Germany: §25 TDDDG) only exempt what is strictly
 * necessary or what the visitor explicitly asked for, which is why the default
 * refuses rather than allows. A host global (`webConsent`): plugins use it too.
 */
import { useSyncExternalStore } from "react";

export type ConsentCategory = "necessary" | "preferences" | "statistics" | "marketing" | "media";
export const CONSENT_CATEGORIES: ConsentCategory[] = ["necessary", "preferences", "statistics", "marketing", "media"];

/** Text that is either written out or an i18n key with its namespace. */
export type ConsentText = string | { key: string; ns?: string };

export interface ConsentDeclaration {
  /** Unique, e.g. `core.xt_rt` or `my-plugin.view-cache`. */
  id: string;
  /** The cookie or storage key, or the service's name. */
  name: string;
  kind: "cookie" | "localStorage" | "sessionStorage" | "service";
  category: ConsentCategory;
  /** Who sets or serves it: "This site", "Fonticons, Inc."… */
  provider: string;
  purpose: ConsentText;
  /** "1 year", "Session"… */
  lifetime?: ConsentText;
  /** For a third-party service: its privacy policy. */
  privacyUrl?: string;
  /** Set by the registry for plugin declarations, from the active plugin. */
  pluginId?: string;
}

export interface ConsentProvider {
  has(category: ConsentCategory): boolean;
  subscribe(fn: () => void): () => void;
  /** Open the consent settings (the "Cookie settings" link). */
  open(): void;
  /** Agree to one category from a placeholder ("Always allow"). */
  grant?(category: ConsentCategory): void;
}

const declarations = new Map<string, ConsentDeclaration>();
const listeners = new Set<() => void>();
let provider: ConsentProvider | null = null;
let providerOff: (() => void) | null = null;
let version = 0;

function emit() {
  version++;
  for (const fn of listeners) fn();
}

/** Declare what you store or load. Re-declaring an id replaces it. */
export function declareConsent(items: ConsentDeclaration | ConsentDeclaration[], pluginId?: string): void {
  for (const d of Array.isArray(items) ? items : [items]) {
    declarations.set(d.id, pluginId ? { ...d, pluginId } : d);
  }
  emit();
}

/** Remove a plugin's declarations (it was disabled). */
export function forgetConsentFor(pluginId: string): void {
  for (const [id, d] of declarations) if (d.pluginId === pluginId) declarations.delete(id);
  emit();
}

export function listConsentDeclarations(): ConsentDeclaration[] {
  return [...declarations.values()];
}

/** The consent plugin registers here; `null` takes it away again. */
export function setConsentProvider(next: ConsentProvider | null): void {
  providerOff?.();
  provider = next;
  providerOff = next ? next.subscribe(emit) : null;
  emit();
}

export function hasConsentProvider(): boolean {
  return provider != null;
}

/** May something in this category run? Necessary always; the rest only with consent. */
export function hasConsent(category: ConsentCategory): boolean {
  if (category === "necessary") return true;
  return provider ? provider.has(category) : false;
}

export function openConsentSettings(): void {
  provider?.open();
}

export function grantConsent(category: ConsentCategory): void {
  provider?.grant?.(category);
}

/** Called whenever a choice, a declaration or the provider changes. */
export function onConsentChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

const getVersion = () => version;

/** `hasConsent` as a subscription, for components. */
export function useConsent(category: ConsentCategory): boolean {
  useSyncExternalStore(onConsentChange, getVersion, getVersion);
  return hasConsent(category);
}

/** Whether a consent plugin is active, as a subscription (the footer link). */
export function useHasConsentProvider(): boolean {
  useSyncExternalStore(onConsentChange, getVersion, getVersion);
  return provider != null;
}

/** The declarations, as a subscription (a cookie policy, a settings dialog). */
export function useConsentDeclarations(): ConsentDeclaration[] {
  useSyncExternalStore(onConsentChange, getVersion, getVersion);
  return listConsentDeclarations();
}

// ── What core itself stores ─────────────────────────────────────────────────
// All first party. Sign-in and the device cookie are set only when someone signs in
// or registers; language and theme only when a visitor picks one.
declareConsent([
  { id: "core.xt_rt", name: "xt_rt", kind: "cookie", category: "necessary", provider: "this",
    purpose: { key: "consent.core.xt_rt", ns: "common" }, lifetime: { key: "consent.life.signIn", ns: "common" } },
  { id: "core.xt_did", name: "xt_did", kind: "cookie", category: "necessary", provider: "this",
    purpose: { key: "consent.core.xt_did", ns: "common" }, lifetime: { key: "consent.life.year1", ns: "common" } },
  { id: "core.xt_oauth", name: "xt_oauth", kind: "cookie", category: "necessary", provider: "this",
    purpose: { key: "consent.core.xt_oauth", ns: "common" }, lifetime: { key: "consent.life.minutes10", ns: "common" } },
  { id: "core.xt_locale", name: "xt_locale", kind: "cookie", category: "necessary", provider: "this",
    purpose: { key: "consent.core.xt_locale", ns: "common" }, lifetime: { key: "consent.life.year1", ns: "common" } },
  { id: "core.xt_theme", name: "xt_theme, xt_cw", kind: "cookie", category: "necessary", provider: "this",
    purpose: { key: "consent.core.xt_theme", ns: "common" }, lifetime: { key: "consent.life.year1", ns: "common" } },
  { id: "core.storage", name: "xentium.*", kind: "localStorage", category: "necessary", provider: "this",
    purpose: { key: "consent.core.storage", ns: "common" }, lifetime: { key: "consent.life.untilCleared", ns: "common" } },
]);

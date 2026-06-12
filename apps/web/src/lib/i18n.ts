import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import Backend from "i18next-http-backend";
import LanguageDetector from "i18next-browser-languagedetector";

/** Locales bundled in v1 (§60.6). `en` is the source + fallback. */
export const SUPPORTED_LOCALES = [
  { code: "en", label: "English",    native: "English"    },
  { code: "de", label: "German",     native: "Deutsch"    },
  { code: "es", label: "Spanish",    native: "Español"    },
  { code: "fr", label: "French",     native: "Français"   },
  { code: "pt", label: "Portuguese", native: "Português"  },
] as const;

export type LocaleCode = (typeof SUPPORTED_LOCALES)[number]["code"];
export const LOCALE_CODES = SUPPORTED_LOCALES.map((l) => l.code) as LocaleCode[];
export const LOCALE_COOKIE = "nv_locale";

/** Frontend namespaces (§60.5). `installer` predates the rest. */
export const NAMESPACES = [
  "common", "auth", "account", "articles", "profiles",
  "pages", "acp", "errors", "validation", "installer", "members", "home",
] as const;

i18n
  .use(Backend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: "en",
    supportedLngs: LOCALE_CODES,
    nonExplicitSupportedLngs: true, // "en-US" → "en"
    ns: NAMESPACES,
    defaultNS: "common",
    load: "languageOnly",
    // §60.3 resolution chain (client mirror): an authenticated user's
    // preferred_locale is applied imperatively after login (see useAuth);
    // an explicit device choice lives in the nv_locale cookie; with neither,
    // the SITE DEFAULT applies (fetched in main.tsx bootstrap from
    // /api/meta/site-locale — it outranks the browser language so an admin's
    // chosen language genuinely takes effect site-wide for new visitors).
    detection: {
      order: ["cookie", "navigator", "htmlTag"],
      lookupCookie: LOCALE_COOKIE,
      // No auto-caching: only an explicit choice (setLocale) writes the
      // cookie. Otherwise every visitor would get pinned to their first
      // detected language and never follow a changed site default.
      caches: [],
    },
    backend: {
      loadPath: "/locales/{{lng}}/{{ns}}.json",
    },
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
  });

/** Persist + apply a locale choice (used by the language switcher). */
export function setLocale(code: LocaleCode) {
  i18n.changeLanguage(code);
  document.cookie = `${LOCALE_COOKIE}=${code}; path=/; max-age=${365 * 24 * 60 * 60}; samesite=lax`;
}

/** Whether this device has an explicit language choice (nv_locale cookie). */
export function hasExplicitLocale(): boolean {
  return document.cookie.split("; ").some((c) => c.startsWith(`${LOCALE_COOKIE}=`));
}

/**
 * Apply the site default language (§60.3, last step of the chain) for
 * visitors with no explicit choice. Called once during bootstrap; never
 * writes the cookie, so these visitors keep following the admin-configured
 * default if it changes later.
 */
export async function applySiteDefaultLocale(): Promise<void> {
  if (hasExplicitLocale()) return;
  try {
    const res = await fetch("/api/meta/site-locale");
    if (!res.ok) return;
    const { locale } = (await res.json()) as { locale: string | null };
    if (locale && (LOCALE_CODES as string[]).includes(locale)) {
      await i18n.changeLanguage(locale);
    }
  } catch {
    /* pre-install or offline — the detector result stands */
  }
}

/**
 * Apply an authenticated user's saved preference — the top of the §60.3 chain.
 * No-op when the user hasn't set one (null), leaving the cookie/browser choice intact.
 */
export function applyServerLocale(locale?: string | null) {
  if (locale && (LOCALE_CODES as string[]).includes(locale)) setLocale(locale as LocaleCode);
}

export default i18n;

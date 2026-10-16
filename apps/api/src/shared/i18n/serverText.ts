/**
 * Server-side text (§60.9): the only prose the API writes itself is what leaves it
 * as email. Everything else stays locale-agnostic (machine keys + NEC codes).
 *
 * The files live in `apps/api/src/locales/<lng>/<ns>.json` and are bundled into the
 * build. `notifications.json` holds the same texts as the web's `common:notify`
 * (a test keeps them equal): the bell reads one, a notification email the other.
 */
import type { Request } from "express";
import { prisma } from "../../infrastructure/db.js";
import { getSetting } from "../utils/settings.js";
import enEmail from "../../locales/en/email.json" with { type: "json" };
import deEmail from "../../locales/de/email.json" with { type: "json" };
import esEmail from "../../locales/es/email.json" with { type: "json" };
import frEmail from "../../locales/fr/email.json" with { type: "json" };
import ptEmail from "../../locales/pt/email.json" with { type: "json" };
import enNotifications from "../../locales/en/notifications.json" with { type: "json" };
import deNotifications from "../../locales/de/notifications.json" with { type: "json" };
import esNotifications from "../../locales/es/notifications.json" with { type: "json" };
import frNotifications from "../../locales/fr/notifications.json" with { type: "json" };
import ptNotifications from "../../locales/pt/notifications.json" with { type: "json" };

export const SERVER_LOCALES = ["en", "de", "es", "fr", "pt"] as const;
export type ServerLocale = (typeof SERVER_LOCALES)[number];

type Tree = { [key: string]: string | Tree };
const RESOURCES: Record<ServerLocale, Record<"email" | "notifications", Tree>> = {
  en: { email: enEmail, notifications: enNotifications },
  de: { email: deEmail, notifications: deNotifications },
  es: { email: esEmail, notifications: esNotifications },
  fr: { email: frEmail, notifications: frNotifications },
  pt: { email: ptEmail, notifications: ptNotifications },
};
export type ServerNamespace = keyof (typeof RESOURCES)["en"];

/** "de-AT" → "de"; anything we do not ship → null. */
export function toServerLocale(v: unknown): ServerLocale | null {
  if (typeof v !== "string") return null;
  const base = v.trim().toLowerCase().slice(0, 2);
  return (SERVER_LOCALES as readonly string[]).includes(base) ? (base as ServerLocale) : null;
}

function lookup(tree: Tree, key: string): string | null {
  let node: string | Tree | undefined = tree;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return null;
    node = node[part];
  }
  return typeof node === "string" ? node : null;
}

/** Whether a text exists at all (in any language — English is always the fallback). */
export function hasServerText(ns: ServerNamespace, key: string): boolean {
  return lookup(RESOURCES.en[ns], key) !== null;
}

/**
 * The text in `locale`, else English, with `{{name}}` filled from `params`. Values
 * are NOT escaped here: an email template's own substitution does that, and a
 * placeholder the text does not fill is left for it.
 */
export function serverText(
  locale: ServerLocale,
  ns: ServerNamespace,
  key: string,
  params: Record<string, string | number> = {},
): string {
  const text = lookup(RESOURCES[locale][ns], key) ?? lookup(RESOURCES.en[ns], key) ?? key;
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole);
}

/**
 * Which language to write to someone in: their account's language, else the
 * language the page they acted from is in (`hint`), else the site default.
 */
export async function recipientLocale(opts: { userId?: string | null; hint?: unknown }): Promise<ServerLocale> {
  if (opts.userId) {
    const user = await prisma.user.findUnique({ where: { id: opts.userId }, select: { preferredLocale: true } });
    const own = toServerLocale(user?.preferredLocale);
    if (own) return own;
  }
  return toServerLocale(opts.hint) ?? toServerLocale(await getSetting<string>("site.locale", "en")) ?? "en";
}

/** The page's language as the web client reports it (`X-Xentium-Locale`). */
export function requestLocaleHint(req: Request): string | undefined {
  return req.get("x-xentium-locale") ?? undefined;
}

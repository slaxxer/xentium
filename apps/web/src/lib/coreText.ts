import i18n from "./i18n";
import { getBlock } from "../layout/blockRegistry";

/*
 * Text core defines IN CODE — block names, block setting titles, scheduled job and
 * task names — in the reader's language. The code keeps its English as the
 * fallback, so a plugin's own block or job (which has no entry under `acp:core`)
 * still shows what the plugin wrote.
 *
 * Paths mirror the `core` tree in acp.json: `blocks.<type>.label`,
 * `blocks.<type>.props.<prop>.title`, `jobs.<key>.description`,
 * `actions.<key>.params.<param>.enum.<value>`, …
 */
export function coreText(path: string, fallback: string): string {
  const key = `acp:core.${path}`;
  return i18n.exists(key) ? String(i18n.t(key)) : fallback;
}

/*
 * A plugin's text for things core draws on its behalf — permission names, its ACP
 * menu entries, nav links, blocks and their settings. A plugin mirrors the
 * `acp:core` tree under `host` in its OWN namespace (`forum:host.permissions.…`);
 * without an entry, what the plugin registered shows as written.
 */
const CORE_NAMESPACES = new Set(["common", "acp", "account"]);

function pluginNamespaces(): string[] {
  const out = new Set<string>();
  for (const lng of Object.values(i18n.store?.data ?? {})) {
    for (const ns of Object.keys(lng)) if (!CORE_NAMESPACES.has(ns)) out.add(ns);
  }
  return [...out];
}

/** The full key of a plugin's `host.<path>` text, or null when no plugin has one. */
export function pluginTextKey(path: string): string | null {
  for (const ns of pluginNamespaces()) {
    const key = `${ns}:host.${path}`;
    if (i18n.exists(key)) return key;
  }
  return null;
}

export function pluginText(path: string, fallback: string): string {
  const key = pluginTextKey(path);
  return key ? String(i18n.t(key)) : fallback;
}

/** Core's text, else a plugin's — for lists that mix both (permissions, block settings). */
export function hostText(path: string, fallback: string): string {
  return coreText(path, pluginText(path, fallback));
}

/**
 * A plugin's registered label (a nav link) that an admin may since have renamed: it
 * translates only while it still equals the plugin's English text.
 */
export function pluginDefaultText(path: string, stored: string): string {
  const key = pluginTextKey(path);
  return key && String(i18n.getFixedT("en")(key)) === stored ? String(i18n.t(key)) : stored;
}

/** A nav link a plugin registered (`host.nav.forum` for "/forum"), until an admin renames it. */
export function pluginNavLabel(url: string, label: string): string {
  return url.startsWith("/") ? pluginDefaultText(`nav.${url.slice(1)}`, label) : label;
}

/** A block's name as the editor shows it. */
export function blockLabel(type: string): string {
  const def = getBlock(type);
  // Core and plugin texts are looked up apart: a plugin's type could collide with a core path.
  const own = def?.editorMeta?.label ?? type;
  return def?.pluginId ? pluginText(`blocks.${type}.label`, own) : coreText(`blocks.${type}.label`, own);
}

/** A permission's name, and the name of the group it is listed under. */
export function permissionLabel(key: string, fallback: string): string {
  return hostText(`permissions.${key}`, fallback);
}
export function permissionDomainLabel(domain: string): string {
  return hostText(`domains.${domain}`, domain);
}

/**
 * The labels core seeds for its own profile fields (bootstrap/seedSystemProfileFields).
 * While a field still carries one it is core text and shows in the reader's language;
 * once an admin renames it, the label is theirs and shows as written.
 */
const SEEDED_FIELD_LABELS: Record<string, string> = {
  date_of_birth: "Date of Birth",
  website:       "Website",
};

export function fieldLabel(field: { key: string; label: string }): string {
  return SEEDED_FIELD_LABELS[field.key] === field.label
    ? String(i18n.t(`common:profileFields.${field.key}`))
    : field.label;
}

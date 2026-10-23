import { z } from "zod";
import { XEC } from "@xentium/contracts";
import { XentiumError } from "@xentium/errors";
import type { PluginSettings, PluginSettingsDeclaration } from "@xentium/plugin-sdk";
import { prisma } from "../../infrastructure/db.js";
import { bustSettingsCache, getSetting } from "../../shared/utils/settings.js";
import { acpPageRegistry } from "../plugin-engine/acp-page-registry.js";
import { pluginRegistry } from "../plugin-engine/plugin-registry.js";

/**
 * Plugin settings (ADR-0011): a plugin declares its settings as a Zod object; core
 * stores them as ONE row (`plugin.<pluginId>`) through the settings cache, applies
 * defaults, validates every save, and draws the ACP page from the schema.
 *
 * Reading is forgiving per key: a stored value that no longer fits the schema (the
 * plugin changed a setting's type in an update) falls back to that key's default,
 * and the others keep theirs. Writing is strict: an invalid value is refused with
 * a per-key message, so the page can show it next to the field.
 *
 * Per-key `.meta()` the page reads: `title`, `description` (a plain string or a
 * translation key in the plugin's namespace), `section` (groups fields into cards),
 * `widget: "color" | "textarea"`, and `public: true` (the plugin's own pages may read
 * it through `GET /api/addons/:pluginId/settings`; everything else is admin-only).
 */

type Shape = Record<string, z.ZodType>;
interface Registered { title: string | null; section: string; schema: z.ZodObject<Shape> }

const registry = new Map<string, Registered>();
const rowKey = (pluginId: string) => `plugin.${pluginId}`;
/** The generated page's route; the ACP shell has a core route for it. */
export const settingsPath = (pluginId: string) => `/admin/addons/${pluginId}/settings`;

function isZodObject(v: unknown): v is z.ZodObject<Shape> {
  return !!v && typeof v === "object" && "shape" in v && typeof (v as { safeParse?: unknown }).safeParse === "function";
}

export function registerSettings(pluginId: string, decl: PluginSettingsDeclaration): void {
  if (!isZodObject(decl.schema)) throw new Error(`[plugin settings] ${pluginId}: "schema" must be a Zod object (z.object({ … })).`);
  for (const [k, field] of Object.entries(decl.schema.shape)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(k)) throw new Error(`[plugin settings] ${pluginId}: "${k}" is not a valid setting key.`);
    // Every setting needs a value when nothing is stored: a default, or optional.
    if (!field.safeParse(undefined).success) throw new Error(`[plugin settings] ${pluginId}: "${k}" needs a .default(…) or .optional().`);
  }
  registry.set(pluginId, { title: decl.title ?? null, section: decl.section ?? "extensions", schema: decl.schema });
  // Its page joins the ACP like any page a plugin registers: under Extensions unless
  // it names a section, labelled with its title or the plugin's name.
  const name = pluginRegistry.get(pluginId)?.manifest.name ?? pluginId;
  acpPageRegistry.register(pluginId, { section: decl.section ?? "extensions", label: decl.title ?? name, path: settingsPath(pluginId) });
}

export function deregisterSettings(pluginId: string): void {
  registry.delete(pluginId);
}

/** Every key resolved: the stored value when it still fits, else that key's default. */
function resolve(schema: z.ZodObject<Shape>, stored: unknown): Record<string, unknown> {
  const raw = stored && typeof stored === "object" && !Array.isArray(stored) ? stored as Record<string, unknown> : {};
  const out: Record<string, unknown> = {};
  for (const [k, field] of Object.entries(schema.shape)) {
    const r = field.safeParse(raw[k]);
    out[k] = r.success ? r.data : field.safeParse(undefined).data;
  }
  return out;
}

function requireRegistered(pluginId: string): Registered {
  const r = registry.get(pluginId);
  if (!r) throw new XentiumError({ code: XEC.PLUGIN_NOT_FOUND, httpStatus: 404, message: "This add-on has no settings, or is not enabled" });
  return r;
}

export async function readSettings(pluginId: string): Promise<Record<string, unknown>> {
  const r = requireRegistered(pluginId);
  return resolve(r.schema, await getSetting<unknown>(rowKey(pluginId), {}));
}

/**
 * Save some keys. Unknown keys and invalid values are refused, all at once, with a
 * message per key; nothing is written unless everything is valid.
 */
export async function writeSettings(pluginId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = requireRegistered(pluginId);
  const errors: Record<string, string> = {};
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    const field = r.schema.shape[k];
    if (!field) { errors[k] = "Unknown setting"; continue; }
    const parsed = field.safeParse(v);
    if (parsed.success) clean[k] = parsed.data;
    else errors[k] = parsed.error.issues[0]?.message ?? "Invalid value";
  }
  if (Object.keys(errors).length) {
    throw new XentiumError({ code: XEC.API_VALIDATION, httpStatus: 422, message: "Some settings are not valid", details: { fields: errors } });
  }
  const stored = await prisma.setting.findUnique({ where: { key: rowKey(pluginId) } });
  const next = { ...resolve(r.schema, stored?.value), ...clean };
  await prisma.setting.upsert({
    where: { key: rowKey(pluginId) },
    update: { value: next as object },
    create: { key: rowKey(pluginId), value: next as object },
  });
  bustSettingsCache(rowKey(pluginId));
  return next;
}

/** What the generated ACP page needs: the schema as JSON Schema (titles, sections, widgets) and the values. */
export async function describeSettings(pluginId: string) {
  const r = requireRegistered(pluginId);
  return { pluginId, title: r.title, schema: z.toJSONSchema(r.schema, { io: "input", unrepresentable: "any" }), values: await readSettings(pluginId) };
}

/** Only the keys marked `.meta({ public: true })`, for the plugin's own pages. */
export async function publicSettings(pluginId: string): Promise<Record<string, unknown>> {
  const r = requireRegistered(pluginId);
  const values = await readSettings(pluginId);
  const out: Record<string, unknown> = {};
  for (const [k, field] of Object.entries(r.schema.shape)) {
    // Through the field's own `.meta()`: a plugin may bundle its own copy of Zod,
    // whose metadata lives in that copy's registry, not ours.
    if ((field.meta() as { public?: unknown } | undefined)?.public === true) out[k] = values[k];
  }
  return out;
}

/** `host.settings` for one plugin. */
export function settingsFor<T extends Record<string, unknown> = Record<string, unknown>>(pluginId: string): PluginSettings<T> {
  return {
    get: () => readSettings(pluginId) as Promise<T>,
    set: (patch) => writeSettings(pluginId, patch as Record<string, unknown>) as Promise<T>,
  };
}

/** For tests. */
export function _resetSettings(): void {
  registry.clear();
}

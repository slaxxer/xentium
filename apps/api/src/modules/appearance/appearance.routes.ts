import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { requirePermission } from "../../shared/middleware/requirePermission.js";
import { CorePermissions, SCOPE_SELECTOR, scopedTokensSchema, tokenMapSchema,
         DEFAULT_ICON_STYLE, isIconStyle,
         COMPOSER_TOOL_IDS, COMPOSER_DEFAULT_CONFIG, resolveComposerConfig } from "@xentium/contracts";
import { appearanceService, parseColourwayId } from "./appearance.service.js";
import { addSseClient } from "./appearance.sse.js";
import { storage } from "../../infrastructure/storage/LocalStorageProvider.js";
import { prisma } from "../../infrastructure/db.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { XEC } from "../../shared/errors/xec.js";
import { parseKitUrl } from "./iconKit.js";
import { bustSettingsCache, getSetting } from "../../shared/utils/settings.js";
import { resolveEditingKey } from "../themes/themeKey.js";

export const appearanceRouter: Router = Router();
const adminGuard = requirePermission(CorePermissions.ADMIN_ACCESS);

/** The theme an admin request edits: `?theme=` (an id, or `_core`), else the active one. */
const themeOf = (req: { query: Record<string, unknown> }) => resolveEditingKey(req.query.theme);

/** ⚠ A settings row is free text. Bad JSON must fall back to the default config,
 *  not 500 the endpoint every editor on the site waits for. */
function safeJson(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return null; }
}

// Public — serves the active token overrides as CSS for injection in the frontend.
// `?source=draft` renders the unpublished draft instead (used by the Style Editor's
// own preview so an admin can see staged changes); it is never cached.
appearanceRouter.get("/css", async (req, res, next) => {
  try {
    const draft = req.query.source === "draft";

    /**
     * A visitor wearing an installed theme that is not the site's.
     *
     * ⚠ No `X-Style-Version` on this response, and no `no-cache` revalidation
     * against the live version either: what is served here is not the live sheet,
     * so stamping it would let the reconciler decide the client is out of date and
     * pull it back to the site's own theme on the next stream tick — the visitor's
     * choice undone by a mechanism designed to fix staleness.
     */
    const wanted = typeof req.query.theme === "string" ? req.query.theme : "";
    /**
     * A colourway the visitor picked of the theme they wear (lib/viewerTheme.ts).
     * Validated against that theme's manifest when the sheet is built, so an id it
     * does not ship is simply not applied.
     */
    const colourway = draft ? null : parseColourwayId(req.query.colourway);
    if (!draft && wanted) {
      const themed = await appearanceService.getThemeCss(wanted, colourway);
      if (themed !== null) {
        res.setHeader("Content-Type", "text/css; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        res.send(themed);
        return;
      }
      // An id naming nothing installed falls through to the live sheet. A cookie
      // outlives an uninstall, and a visitor holding a stale one must see the site,
      // not an error and not a blank page.
    }

    let css: string;
    if (draft) {
      // The draft of the theme an editor is previewing (`?theme=`, else the active one):
      // what it ships, under the admin's staged edits to it.
      const key = await resolveEditingKey(req.query.theme);
      css = await appearanceService.buildCSS(await appearanceService.getEffectiveDraftTokens(key), { key, draft: true });
    } else {
      // Still the LIVE sheet with a colourway over it, so it keeps its version stamp:
      // an admin's publish must still reach a reader who only changed the accent.
      css = await appearanceService.getLiveCss(colourway);
    }
    res.setHeader("Content-Type", "text/css; charset=utf-8");
    /**
     * The version of the stylesheet in this response, so a client can tell what it
     * is HOLDING from what the server is announcing. Without it, a page that loaded
     * a cached stylesheet adopts the SSE's first version as its own baseline, sees
     * no change, and stays painted in the previous theme — which is exactly what a
     * theme switch looked like from the site.
     */
    if (!draft) {
      // LIVE only. The draft stylesheet is not what the stream announces, so
      // stamping it would let a preview reconcile itself back to the live theme.
      res.setHeader("X-Style-Version", String(await appearanceService.getStyleVersion()));
      res.setHeader("Access-Control-Expose-Headers", "X-Style-Version");
    }
    /**
     * `no-cache` means REVALIDATE, not "do not store": the ETag turns the usual
     * request into a 304 with no body, so the cache still saves the bytes while the
     * first paint is always the current theme. `max-age=60` bought a little less
     * traffic at the price of up to a minute of the OLD theme on every load right
     * after a change — the one moment anybody is looking.
     */
    res.setHeader("Cache-Control", draft ? "no-store" : "no-cache");
    res.send(css);
  } catch (err) { next(err); }
});

// Public — tiny liveness probe. Clients poll this and only refetch /css when
// `version` changes. `intervalMs` lets the server drive the poll cadence live,
// so the refresh interval is adjustable from the ACP without a redeploy.
appearanceRouter.get("/version", async (_req, res, next) => {
  try {
    const [version, seconds] = await Promise.all([
      appearanceService.getStyleVersion(),
      appearanceService.getLiveRefreshSeconds(),
    ]);
    res.setHeader("Cache-Control", "no-store");
    res.json({ version, intervalMs: seconds * 1000 });
  } catch (err) { next(err); }
});

// Public — live style sync (push). Each client holds one SSE connection; the
// server pushes a `version` event only when the active theme actually changes.
// Replaces polling /version. Exempt from the global rate limiter (see rateLimit.ts).
appearanceRouter.get("/stream", async (_req, res, next) => {
  try {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // disable nginx response buffering for this stream
    res.flushHeaders?.();
    const version = await appearanceService.getStyleVersion();
    addSseClient(res, version); // keeps the connection open until the client disconnects
  } catch (err) { next(err); }
});

// Admin — read current tokens
appearanceRouter.get("/tokens", adminGuard, async (req, res, next) => {
  try {
    const key = await themeOf(req);
    // `tokens` is the ADMIN layer ALONE — the editor writes back what it reads, so
    // returning the merged set would turn every theme value into an admin override and
    // quietly destroy the inheritance. `theme` is additive: the editor shows those
    // values as the inherited baseline, which is what "Reset" now falls back to.
    // `theme` is what the theme being edited SHIPS — the baseline under the edits.
    const [admin, theme, installed] = await Promise.all([
      appearanceService.getTokens(key),
      appearanceService.getThemeTokens(key),
      appearanceService.getInstalledTheme(),
    ]);
    res.json({ tokens: admin, theme, installedTheme: installed });
  } catch (err) { next(err); }
});

// Admin — save tokens
appearanceRouter.put("/tokens", adminGuard, async (req, res, next) => {
  try {
    // Scope-keyed shape (ADR-0003): { global: {..}, navbar: {..} }. ONE map, because a
    // site has one look. Names and values are validated (shared with theme import):
    // every token here is emitted verbatim into the served stylesheet, and a value
    // carrying `}` would close the block early — trusted admin or not, that is not
    // worth leaving open.
    const body = z.object({
      tokens: scopedTokensSchema,
      label:  z.string().optional(),
    }).parse(req.body);

    // Edits land in the DRAFT — they go live only on the Theme Studio's Publish.
    // No version bump here, so other clients
    // keep seeing the published theme until publish.
    await appearanceService.saveDraftTokens(body.tokens, req.userId!, await themeOf(req));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/**
 * Admin — patch ONE scope of the draft.
 *
 * Exists for the Layout Editor's variant panel: two surfaces editing the same draft by
 * read-modify-write of the whole token set lose whichever edit landed first. A `null`
 * value clears that token (back to inherited).
 */
appearanceRouter.patch("/tokens/scope/:scope", adminGuard, async (req, res, next) => {
  try {
    const { scope } = z.object({
      // Only a scope this build knows — an unknown one would be stored and then
      // silently skipped by buildCSS, which looks like the save failed.
      scope: z.string().refine((s) => s === "global" || s in SCOPE_SELECTOR, "unknown scope"),
    }).parse(req.params);

    // `null` clears; the value rules are the same as a full token save.
    const clearable = z.record(
      tokenMapSchema.keyType,
      z.union([tokenMapSchema.valueType, z.null()]),
    );
    const body = z.object({ tokens: clearable }).parse(req.body ?? {});

    res.json(await appearanceService.saveDraftScope(scope, body.tokens, req.userId!, await themeOf(req)));
  } catch (err) { next(err); }
});

// Admin — read raw per-theme custom CSS for the console editor
appearanceRouter.get("/custom-css", adminGuard, async (req, res, next) => {
  try {
    const key = await themeOf(req);
    // Same shape and the same reason as `/tokens`: `css` is the ADMIN layer alone,
    // because the console writes back exactly what it reads — returning the two layers
    // concatenated would save the theme's stylesheet as the admin's own, and the next
    // theme update would have nothing left to inherit. `theme` is additive, and it is
    // the STAGED layer so the console agrees with the preview during the window between
    // importing a theme and publishing it. `css` is the admin's DRAFT (the live sheet
    // while nothing is staged): the console edits what Publish will put live.
    const [admin, theme] = await Promise.all([
      appearanceService.getDraftCustomCss(key),
      appearanceService.getThemeCustomCss(key),
    ]);
    res.json({ css: admin, theme });
  } catch (err) { next(err); }
});

// Admin — stage raw per-theme custom CSS. Goes live with the Theme Studio's Publish.
appearanceRouter.put("/custom-css", adminGuard, async (req, res, next) => {
  try {
    const body = z.object({ css: z.string().max(100_000) }).parse(req.body);
    await appearanceService.saveDraftCustomCss(body.css, await themeOf(req));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Admin — scope a raw blob (live preview; does not persist)
appearanceRouter.post("/custom-css/preview", adminGuard, async (req, res, next) => {
  try {
    const { css } = z.object({ css: z.string().max(100_000) }).parse(req.body);
    res.json({ css: appearanceService.scopeCss(css) });
  } catch (err) { next(err); }
});

// Admin — is there a staged (draft) change waiting to be published?
appearanceRouter.get("/draft-status", adminGuard, async (req, res, next) => {
  try {
    res.json(await appearanceService.getDraftStatus(await themeOf(req)));
  } catch (err) { next(err); }
});

// Admin — publish the draft now (Run now). Promotes draft → live + SSE push.
appearanceRouter.post("/publish", adminGuard, async (req, res, next) => {
  try {
    const published = await appearanceService.publishDraft(req.userId!, undefined, await themeOf(req));
    res.json({ ok: true, published });
  } catch (err) { next(err); }
});

// Admin — reset all appearance overrides → inherit the bundled core design
appearanceRouter.post("/reset", adminGuard, async (req, res, next) => {
  try {
    await appearanceService.resetAppearance(await themeOf(req));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Admin — one theme's site font (family / weight / size), as STAGED: the editor edits
// the draft, and the Theme Studio's Publish puts it live with the colours.
appearanceRouter.get("/font", adminGuard, async (req, res, next) => {
  try {
    res.json(await appearanceService.getDraftFont(await themeOf(req)));
  } catch (err) { next(err); }
});

appearanceRouter.put("/font", adminGuard, async (req, res, next) => {
  try {
    const body = z.object({
      family: z.string().max(200).optional(),
      weight: z.string().max(10).optional(),
      size:   z.string().max(10).optional(),
    }).parse(req.body ?? {});
    await appearanceService.saveDraftFont(body, await themeOf(req));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Admin — restore a history entry
appearanceRouter.post("/history/:id/restore", adminGuard, async (req, res, next) => {
  try {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const tokens = await appearanceService.restoreHistory(id, req.userId!);
    res.json(tokens);
  } catch (err) { next(err); }
});

// ── Branding (logo + favicon) ─────────────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 2 * 1024 * 1024 },
});

const BRANDING_VARIANTS = ["navbar", "icon"] as const;
type BrandingVariant = typeof BRANDING_VARIANTS[number];

const ALLOWED_MIME: Record<BrandingVariant, string[]> = {
  navbar: ["image/png", "image/svg+xml", "image/webp", "image/jpeg"],
  icon:   ["image/png", "image/x-icon", "image/svg+xml", "image/ico"],
};

const EXT: Record<string, string> = {
  "image/png": "png", "image/svg+xml": "svg", "image/webp": "webp",
  "image/jpeg": "jpg", "image/x-icon": "ico", "image/ico": "ico",
};

// Public — returns current branding settings
appearanceRouter.get("/branding", async (_req, res, next) => {
  try {
    const [navbar, icon, logoText, iconKit, iconStyle] = await Promise.all([
      prisma.setting.findUnique({ where: { key: "appearance.logo.navbar" } }),
      prisma.setting.findUnique({ where: { key: "appearance.logo.icon"   } }),
      prisma.setting.findUnique({ where: { key: "appearance.logo.text"   } }),
      prisma.setting.findUnique({ where: { key: "appearance.icons.kit"   } }),
      prisma.setting.findUnique({ where: { key: "appearance.icons.style" } }),
    ]);
    const toUrl = (row: { value: unknown } | null) => {
      const v = row?.value as string | null;
      if (!v) return null;
      return v.startsWith("http") ? v : `/uploads/${v}`;
    };
    res.json({
      navbarUrl:  toUrl(navbar),
      iconUrl:    toUrl(icon),
      logoText:   (logoText?.value as string | null) ?? null,
      // ⚠ Validated on the way OUT too, not just when it was written. This value
      // becomes a `<script src>` in every visitor's browser, and a settings row can
      // arrive from a restored backup or a hand-edited database — the write path is
      // not the only way one appears.
      iconKitUrl: parseKitUrl(iconKit?.value),
      // ⚠ Also normalised on the way out: an unknown style must read as "solid",
      // which is the bundled free set, rather than emitting a class nothing defines
      // and leaving every icon on the page blank.
      iconStyle: isIconStyle(iconStyle?.value) ? iconStyle!.value : DEFAULT_ICON_STYLE,
    });
  } catch (err) { next(err); }
});

// Admin — upload logo or favicon
appearanceRouter.post("/branding/:variant", adminGuard, upload.single("file"), async (req, res, next) => {
  try {
    const { variant } = z.object({ variant: z.enum(BRANDING_VARIANTS) }).parse(req.params);
    const file = req.file;
    if (!file) {
      throw new XentiumError({ code: XEC.API_VALIDATION, httpStatus: 400, message: "No file uploaded" });
    }

    const mime = file.mimetype;
    if (!ALLOWED_MIME[variant].includes(mime)) {
      throw new XentiumError({ code: XEC.STORE_TYPE_NOT_PERMITTED, httpStatus: 400, message: `File type ${mime} not allowed for ${variant}` });
    }

    const ext      = EXT[mime] ?? "bin";
    const filename = `${variant}.${ext}`;
    const relPath  = await storage.save("themes/logo", filename, file.buffer);

    await prisma.setting.upsert({
      where:  { key: `appearance.logo.${variant}` },
      update: { value: relPath },
      create: { key: `appearance.logo.${variant}`, value: relPath },
    });

    res.json({ url: storage.publicUrl(relPath) });
  } catch (err) { next(err); }
});

// Admin — delete logo / favicon (revert to default)
appearanceRouter.delete("/branding/:variant", adminGuard, async (req, res, next) => {
  try {
    const { variant } = z.object({ variant: z.enum(BRANDING_VARIANTS) }).parse(req.params);
    const row = await prisma.setting.findUnique({ where: { key: `appearance.logo.${variant}` } });
    if (row?.value) {
      await storage.delete(row.value as string).catch(() => null);
    }
    await prisma.setting.deleteMany({ where: { key: `appearance.logo.${variant}` } });
    res.status(204).end();
  } catch (err) { next(err); }
});

// Admin — save logo text
/**
 * The site's FontAwesome kit.
 *
 * ⚠ Its OWN endpoint rather than the generic `PUT /admin/settings/:key`, because
 * this is the one setting whose value is executed as JavaScript by every visitor.
 * The generic endpoint takes any key and any string; this one takes a kit and
 * nothing else. Sending an empty string clears it.
 */
appearanceRouter.put("/branding/icon-style", adminGuard, async (req, res, next) => {
  try {
    // ⚠ Validated against the shared list, so a style the app cannot turn into
    // classes can never be stored — an unknown one would blank every icon.
    const { style } = z.object({
      style: z.string().refine(isIconStyle, "Unknown icon style"),
    }).parse(req.body);
    await prisma.setting.upsert({
      where:  { key: "appearance.icons.style" },
      update: { value: style },
      create: { key: "appearance.icons.style", value: style },
    });
    bustSettingsCache("appearance.icons.style");
    res.json({ iconStyle: style });
  } catch (err) { next(err); }
});

appearanceRouter.put("/branding/icon-kit", adminGuard, async (req, res, next) => {
  try {
    const { kit } = z.object({ kit: z.string().max(200) }).parse(req.body);
    const url = kit.trim() ? parseKitUrl(kit) : "";
    if (url === null) {
      throw new XentiumError({
        code: XEC.API_VALIDATION, httpStatus: 400,
        message: "Not a FontAwesome kit. Paste the kit id, or its https://kit.fontawesome.com/... URL.",
      });
    }
    await prisma.setting.upsert({
      where:  { key: "appearance.icons.kit" },
      update: { value: url },
      create: { key: "appearance.icons.kit", value: url },
    });
    bustSettingsCache("appearance.icons.kit");
    res.json({ iconKitUrl: url || null });
  } catch (err) { next(err); }
});

/**
 * The composer's tool set.
 *
 * ⚠ The GET is PUBLIC and unauthenticated, like `/css` and `/branding`: every member
 * who can write a comment needs it before their editor can draw a toolbar, and a
 * guest reading a thread renders the same page shell.
 *
 * ⚠ It answers a RESOLVED config, never the raw row — the value is a settings blob
 * that survives backup restores and hand edits, and the editor must not be handed a
 * bar it cannot render. See `resolveComposerConfig`.
 */
appearanceRouter.get("/composer", async (_req, res, next) => {
  try {
    const row = await getSetting<string>("composer.config", "");
    /**
     * ⚠ NO row means the shipped default — the six tools of the redesign — not an
     * empty resolve. `resolveComposerConfig(null)` answers "nothing in the bar",
     * which is a legitimate ANSWER for an admin who emptied it deliberately and a
     * broken editor for a site that never opened this page.
     */
    res.json(row ? resolveComposerConfig(safeJson(row)).config : COMPOSER_DEFAULT_CONFIG);
  } catch (err) { next(err); }
});

appearanceRouter.put("/composer", adminGuard, async (req, res, next) => {
  try {
    const body = z.object({
      bar:      z.array(z.enum(COMPOSER_TOOL_IDS)).max(COMPOSER_TOOL_IDS.length),
      off:      z.array(z.enum(COMPOSER_TOOL_IDS)).max(COMPOSER_TOOL_IDS.length),
      mentions: z.boolean(),
    }).parse(req.body);

    // Stored through the resolver, so the row on disk is already canonical:
    // de-duplicated, unknown ids dropped, and `off` beating `bar`.
    const { config } = resolveComposerConfig(body);
    await prisma.setting.upsert({
      where:  { key: "composer.config" },
      update: { value: JSON.stringify(config) },
      create: { key: "composer.config", value: JSON.stringify(config) },
    });
    bustSettingsCache("composer.config");
    res.json(config);
  } catch (err) { next(err); }
});

appearanceRouter.put("/branding/text", adminGuard, async (req, res, next) => {
  try {
    const { text } = z.object({ text: z.string().max(80) }).parse(req.body);
    await prisma.setting.upsert({
      where:  { key: "appearance.logo.text" },
      update: { value: text },
      create: { key: "appearance.logo.text", value: text },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

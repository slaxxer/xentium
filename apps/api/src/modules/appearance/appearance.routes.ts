import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { requirePermission } from "../../shared/middleware/requirePermission.js";
import { CorePermissions, SCOPE_SELECTOR, scopedTokensSchema, tokenMapSchema } from "@nodevo/contracts";
import { appearanceService } from "./appearance.service.js";
import { addSseClient } from "./appearance.sse.js";
import { storage } from "../../infrastructure/storage/LocalStorageProvider.js";
import { prisma } from "../../infrastructure/db.js";
import { NodevoError } from "../../shared/errors/NodevoError.js";
import { NEC } from "../../shared/errors/nec.js";

export const appearanceRouter: Router = Router();
const adminGuard = requirePermission(CorePermissions.ADMIN_ACCESS);

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
    if (!draft && wanted) {
      const themed = await appearanceService.getThemeCss(wanted);
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

    const css   = draft
      // Effective, not just the admin layer: the draft has to preview the theme it is
      // layered over, or a site with a theme installed previews as if it had none.
      ? await appearanceService.buildCSS(
          await appearanceService.getEffectiveDraftTokens(),
          // The STAGED stylesheet too, not just the staged tokens — otherwise a
          // theme being previewed wears its own colours under the previous theme's
          // CSS, which is a look neither theme has.
          { draft: true },
        )
      : await appearanceService.getLiveCss();
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
appearanceRouter.get("/tokens", adminGuard, async (_req, res, next) => {
  try {
    // `light`/`dark` stay the ADMIN layer alone — the editor writes back what it reads,
    // so returning the merged set would turn every theme value into an admin override
    // and quietly destroy the inheritance. `theme` is additive: the editor shows those
    // values as the inherited baseline, which is what "Reset" now falls back to.
    const [admin, theme, installed] = await Promise.all([
      appearanceService.getTokens(),
      // The STAGED theme layer, because the editor edits the draft: its "Inherited"
      // labels and its preview must agree, and during the window between importing a
      // theme and publishing it, the incoming theme is what a cleared override falls
      // back to.
      appearanceService.getThemeDraftTokens(),
      appearanceService.getInstalledTheme(),
    ]);
    res.json({ ...admin, theme, installedTheme: installed });
  } catch (err) { next(err); }
});

// Admin — save tokens
appearanceRouter.put("/tokens", adminGuard, async (req, res, next) => {
  try {
    // Scope-keyed shape (ADR-0003): { light: { global: {..}, navbar: {..} }, dark: {..} }.
    // Names and values are validated (shared with theme import): every token here is
    // emitted verbatim into the served stylesheet, and a value carrying `}` would close
    // the block early — trusted admin or not, that is not worth leaving open.
    const body = z.object({
      light: scopedTokensSchema,
      dark:  scopedTokensSchema,
      label: z.string().optional(),
    }).parse(req.body);

    // Edits land in the DRAFT — they go live only on publish (Run now or the
    // scheduled appearance-publish job). No version bump here, so other clients
    // keep seeing the published theme until publish.
    await appearanceService.saveDraftTokens(
      { light: body.light, dark: body.dark },
      req.userId!,
    );
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
    const body = z.object({ light: clearable.optional(), dark: clearable.optional() }).parse(req.body ?? {});

    res.json(await appearanceService.saveDraftScope(scope, body, req.userId!));
  } catch (err) { next(err); }
});

// Admin — read raw per-theme custom CSS for the console editor
appearanceRouter.get("/custom-css", adminGuard, async (_req, res, next) => {
  try {
    // Same shape and the same reason as `/tokens`: `light`/`dark` are the ADMIN layer
    // alone, because the console writes back exactly what it reads — returning the two
    // layers concatenated would save the theme's stylesheet as the admin's own, and the
    // next theme update would have nothing left to inherit. `theme` is additive, and it
    // is the STAGED layer so the console agrees with the preview during the window
    // between importing a theme and publishing it.
    const [admin, theme] = await Promise.all([
      appearanceService.getCustomCss(),
      appearanceService.getThemeDraftCustomCss(),
    ]);
    res.json({ ...admin, theme });
  } catch (err) { next(err); }
});

// Admin — save raw per-theme custom CSS (trusted boundary; bumps style version → live sync)
appearanceRouter.put("/custom-css", adminGuard, async (req, res, next) => {
  try {
    const body = z.object({
      light: z.string().max(100_000),
      dark:  z.string().max(100_000),
    }).parse(req.body);
    await appearanceService.saveCustomCss(body);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Admin — scope a raw blob for one theme (live preview; does not persist)
appearanceRouter.post("/custom-css/preview", adminGuard, async (req, res, next) => {
  try {
    const { css, theme } = z.object({
      css:   z.string().max(100_000),
      theme: z.enum(["light", "dark"]),
    }).parse(req.body);
    res.json({ css: appearanceService.scopeCss(css, theme) });
  } catch (err) { next(err); }
});

// Admin — is there a staged (draft) change waiting to be published?
appearanceRouter.get("/draft-status", adminGuard, async (_req, res, next) => {
  try {
    res.json(await appearanceService.getDraftStatus());
  } catch (err) { next(err); }
});

// Admin — publish the draft now (Run now). Promotes draft → live + SSE push.
appearanceRouter.post("/publish", adminGuard, async (req, res, next) => {
  try {
    const published = await appearanceService.publishDraft(req.userId!);
    res.json({ ok: true, published });
  } catch (err) { next(err); }
});

// Admin — reset all appearance overrides → inherit the bundled core design
appearanceRouter.post("/reset", adminGuard, async (_req, res, next) => {
  try {
    await appearanceService.resetAppearance();
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
    const [navbar, icon, logoText] = await Promise.all([
      prisma.setting.findUnique({ where: { key: "appearance.logo.navbar" } }),
      prisma.setting.findUnique({ where: { key: "appearance.logo.icon"   } }),
      prisma.setting.findUnique({ where: { key: "appearance.logo.text"   } }),
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
    });
  } catch (err) { next(err); }
});

// Admin — upload logo or favicon
appearanceRouter.post("/branding/:variant", adminGuard, upload.single("file"), async (req, res, next) => {
  try {
    const { variant } = z.object({ variant: z.enum(BRANDING_VARIANTS) }).parse(req.params);
    const file = req.file;
    if (!file) {
      throw new NodevoError({ code: NEC.API_VALIDATION, httpStatus: 400, message: "No file uploaded" });
    }

    const mime = file.mimetype;
    if (!ALLOWED_MIME[variant].includes(mime)) {
      throw new NodevoError({ code: NEC.STORE_TYPE_NOT_PERMITTED, httpStatus: 400, message: `File type ${mime} not allowed for ${variant}` });
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

import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Request, RequestHandler } from "express";
import {
  listTemplates,
  templateAcceptsVariants,
  type LayoutSelector,
} from "@nodevo/contracts";
import { layoutService } from "./layout.service.js";
import { storage } from "../../infrastructure/storage/LocalStorageProvider.js";
import {
  templateKeyParamSchema,
  variantQuerySchema,
  saveDraftSchema,
} from "./layout.validation.js";

/** Which stored document a request addresses: template from the path, variant from
 *  the query. One place, so no handler can forget the variant and edit the default. */
function selectorOf(req: Request): LayoutSelector {
  const { templateKey } = templateKeyParamSchema.parse(req.params);
  const { variant } = variantQuerySchema.parse(req.query);
  return { templateKey, variant };
}

export const layoutController = {
  /**
   * Public: every published document. Served on page render, so it is memoized
   * in-process and carries no user-specific content — layouts are global.
   */
  publicList: (async (_req, res) => {
    res.json(await layoutService.getPublishedAll());
  }) as RequestHandler,

  /**
   * The template catalogue the editor offers: keys, regions, whether the template can
   * carry per-instance layouts, and its inheritance state.
   *
   * Built from the REGISTRY, so an enabled plugin's templates appear here and a
   * disabled one's disappear — this endpoint is what the editor's picker is made of,
   * and it is the only place that knows a plugin template's label and preview route.
   */
  templates: (async (_req, res) => {
    // `hasTheme` decides whether the editor offers "Revert to theme" at all, and
    // `customised` is what an update would have kept — both belong to the catalogue the
    // editor already fetches rather than a second round trip per template.
    const ownership = await layoutService.getOwnership();
    res.json(
      listTemplates().map((def) => ({
        key:     def.key,
        regions: def.regions,
        // Core's label is a translation key the ACP already owns; a plugin's is the
        // literal it declared, in the plugin's own language. Absent means "core —
        // localize it yourself", which is what the editor keys off.
        label:        def.label ?? null,
        pluginId:     def.pluginId ?? null,
        previewRoute: def.previewRoute ?? null,
        supportsVariants: templateAcceptsVariants(def.key),
        hasTheme:   ownership[def.key]?.hasTheme ?? false,
        customised: ownership[def.key]?.customised ?? false,
      })),
    );
  }) as RequestHandler,

  /** Every template as the draft would render it — the preview iframe's source. */
  draftAll: (async (_req, res) => {
    res.json(await layoutService.getDraftAll());
  }) as RequestHandler,

  /** Variant keys that already carry their own document, for the editor's picker. */
  variants: (async (req, res) => {
    const { templateKey } = templateKeyParamSchema.parse(req.params);
    res.json(await layoutService.listVariants(templateKey));
  }) as RequestHandler,

  /** Put a template back to what the installed theme ships, as a draft. */
  revertToTheme: (async (req, res) => {
    const { templateKey } = templateKeyParamSchema.parse(req.params);
    const doc = await layoutService.revertToTheme(templateKey, req.userId!);
    if (!doc) {
      // Not an error worth a 500, and not silent either: there is simply nothing to
      // inherit from, which the editor should say rather than appear to have acted.
      res.status(404).json({ error: { code: "NEC-API-4404", message: "No installed theme ships this template." } });
      return;
    }
    res.json(doc);
  }) as RequestHandler,

  getDraft: (async (req, res) => {
    res.json(await layoutService.getDraft(selectorOf(req)));
  }) as RequestHandler,

  saveDraft: (async (req, res) => {
    const parsedBody = saveDraftSchema.parse(req.body ?? {});
    // Passed through as-is: `undefined` (key absent) means "skip the check", which is
    // a different instruction from `null` ("there was no row"), so it must not be
    // normalised on the way in.
    res.json(await layoutService.saveDraft(
      selectorOf(req), parsedBody.document, req.userId!, parsedBody.baseVersion,
    ));
  }) as RequestHandler,

  draftStatus: (async (_req, res) => {
    res.json(await layoutService.getDraftStatus());
  }) as RequestHandler,

  publish: (async (req, res) => {
    res.json(await layoutService.publish(req.userId!));
  }) as RequestHandler,

  discardDraft: (async (req, res) => {
    await layoutService.discardDraft(selectorOf(req));
    res.json({ ok: true });
  }) as RequestHandler,

  reset: (async (req, res) => {
    await layoutService.reset(selectorOf(req));
    res.json({ ok: true });
  }) as RequestHandler,

  /**
   * An image for a block that takes one — today the `section` background an admin
   * places behind a masthead.
   *
   * Its own directory (`layouts/`) rather than a page's or an article's, because it
   * belongs to the site's STRUCTURE and outlives any one piece of content: deleting
   * the page a background was first uploaded from must not blank the site header.
   *
   * The filename is random, not the admin's. Two admins uploading `header.jpg` a
   * month apart must not silently replace each other's band, and the original name
   * is attacker-controlled text we have no reason to keep. The extension comes from
   * the magic-byte sniff the upload middleware already did, never from the name.
   */
  uploadImage: (async (req, res) => {
    const file = req.file!;
    const name = `${randomUUID()}.${file.detectedExt ?? "bin"}`;
    const relPath = await storage.save(path.join("layouts"), name, file.buffer);
    // The stored PATH is what a document holds — `resolveImageSource` turns it into
    // a URL, and the theme exporter needs the path to find the bytes on disk.
    res.status(201).json({ path: relPath, url: storage.publicUrl(relPath) });
  }) as RequestHandler,
};

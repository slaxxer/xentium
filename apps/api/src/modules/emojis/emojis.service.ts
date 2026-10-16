/**
 * Custom emojis (ACP → Content → Emojis). The editor's picker reads the active ones;
 * a post stores the image itself, so retiring an emoji never breaks a post — it only
 * leaves the picker. Files live under `emojis/`.
 */
import { randomUUID } from "node:crypto";
import { type EmojiRow } from "@xentium/contracts";
import { prisma } from "../../infrastructure/db.js";
import { storage } from "../../infrastructure/storage/LocalStorageProvider.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { XEC } from "../../shared/errors/xec.js";

type Row = { id: string; shortcode: string; name: string; category: string; image: string; position: number };

const toRow = (e: Row): EmojiRow => ({
  id: e.id, shortcode: e.shortcode, name: e.name, category: e.category,
  url: storage.publicUrl(e.image), position: e.position,
});

const taken = (shortcode: string) => new XentiumError({
  code: XEC.API_CONFLICT, httpStatus: 409,
  message: `The shortcode :${shortcode}: is already used by another emoji.`,
});

const ORDER = [{ category: "asc" as const }, { position: "asc" as const }, { shortcode: "asc" as const }];

export const emojiService = {
  /** What the picker offers. */
  async listActive(): Promise<EmojiRow[]> {
    return (await prisma.emoji.findMany({ where: { retiredAt: null }, orderBy: ORDER })).map(toRow);
  },

  async create(
    input: { shortcode: string; name?: string; category?: string },
    file: { buffer: Buffer; ext: string },
    userId: string,
  ): Promise<EmojiRow> {
    // A retired emoji keeps its shortcode: a post's alt text still names it.
    if (await prisma.emoji.findUnique({ where: { shortcode: input.shortcode }, select: { id: true } })) {
      throw taken(input.shortcode);
    }
    const category = input.category?.trim() ?? "";
    const last = await prisma.emoji.aggregate({ where: { category, retiredAt: null }, _max: { position: true } });
    const image = await storage.save("emojis", `${randomUUID()}.${file.ext}`, file.buffer);
    const row = await prisma.emoji.create({
      data: {
        shortcode: input.shortcode,
        name: input.name?.trim() || input.shortcode,
        category,
        image,
        position: (last._max.position ?? -1) + 1,
        createdById: userId,
      },
    });
    return toRow(row);
  },

  async update(id: string, patch: { shortcode?: string; name?: string; category?: string }): Promise<EmojiRow> {
    const current = await prisma.emoji.findUnique({ where: { id } });
    if (!current || current.retiredAt) {
      throw new XentiumError({ code: XEC.API_NOT_FOUND, httpStatus: 404, message: "Emoji not found" });
    }
    if (patch.shortcode && patch.shortcode !== current.shortcode
        && await prisma.emoji.findUnique({ where: { shortcode: patch.shortcode }, select: { id: true } })) {
      throw taken(patch.shortcode);
    }
    const row = await prisma.emoji.update({
      where: { id },
      data: {
        ...(patch.shortcode ? { shortcode: patch.shortcode } : {}),
        ...(patch.name !== undefined ? { name: patch.name.trim() || patch.shortcode || current.shortcode } : {}),
        ...(patch.category !== undefined ? { category: patch.category.trim() } : {}),
      },
    });
    return toRow(row);
  },

  /** Out of the picker. The file and the row stay, so posts that used it still show it. */
  async retire(id: string): Promise<void> {
    await prisma.emoji.updateMany({ where: { id, retiredAt: null }, data: { retiredAt: new Date() } });
  },
};

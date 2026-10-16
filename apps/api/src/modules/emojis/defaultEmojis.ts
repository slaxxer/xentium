/**
 * The emojis every install starts with: nine smileys, in the picker from the first day.
 *
 * Seeded ONCE (`emojis.defaultsSeeded`), like the bundled themes: after that they are
 * ordinary rows the admin owns. Retiring or renaming one sticks, and a shortcode the
 * admin already uses is left alone rather than overwritten.
 */
import { randomUUID } from "node:crypto";
import { prisma } from "../../infrastructure/db.js";
import { storage } from "../../infrastructure/storage/LocalStorageProvider.js";
import { getFreshSetting, bustSettingsCache } from "../../shared/utils/settings.js";
import { DEFAULT_EMOJI_PNG } from "./defaultEmojis.data.js";

const FLAG = "emojis.defaultsSeeded";
const CATEGORY = "Smileys";

/** Picker order. */
export const DEFAULT_EMOJIS: Array<{ shortcode: string; name: string }> = [
  { shortcode: "happy",      name: "Happy" },
  { shortcode: "sad",        name: "Sad" },
  { shortcode: "laugh",      name: "Laugh" },
  { shortcode: "happy-face", name: "Happy face" },
  { shortcode: "sad-face",   name: "Sad face" },
  { shortcode: "laughing",   name: "Laughing" },
  { shortcode: "heart-eyes", name: "Heart eyes" },
  { shortcode: "bored",      name: "Bored" },
  { shortcode: "sleeping",   name: "Sleeping" },
];

export async function ensureDefaultEmojis(): Promise<void> {
  if (await getFreshSetting<boolean>(FLAG, false)) return;

  const taken = new Set((await prisma.emoji.findMany({
    where: { shortcode: { in: DEFAULT_EMOJIS.map((e) => e.shortcode) } }, select: { shortcode: true },
  })).map((e) => e.shortcode));
  const last = await prisma.emoji.aggregate({ where: { category: CATEGORY, retiredAt: null }, _max: { position: true } });
  let position = (last._max.position ?? -1) + 1;

  for (const e of DEFAULT_EMOJIS) {
    if (taken.has(e.shortcode)) continue;
    const image = await storage.save("emojis", `${e.shortcode}-${randomUUID()}.png`, Buffer.from(DEFAULT_EMOJI_PNG[e.shortcode]!, "base64"));
    await prisma.emoji.create({ data: { shortcode: e.shortcode, name: e.name, category: CATEGORY, image, position: position++ } });
  }

  await prisma.setting.upsert({ where: { key: FLAG }, update: { value: true }, create: { key: FLAG, value: true } });
  bustSettingsCache(FLAG);
}

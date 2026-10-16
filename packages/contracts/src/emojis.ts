/**
 * Custom emojis: an admin uploads them (ACP → Content → Emojis), the editor's picker
 * offers them, and a post stores each as `<img class="xt-emoji" src="/uploads/emojis/…"
 * alt=":shortcode:">` — the image, so a post keeps showing it after the emoji is retired.
 */
import { z } from 'zod';

/** `:party_parrot:` → `party_parrot`. Lowercase, digits, `_`, `-`, `+`. */
export const emojiShortcodeSchema = z.string().trim().toLowerCase()
  .regex(/^[a-z0-9_+-]{2,32}$/, 'a shortcode is 2–32 of a–z, 0–9, _ - +');

export const emojiCategorySchema = z.string().trim().max(40);

/** The path every emoji image is served under — what the sanitizer allows, and nothing else. */
export const EMOJI_URL_PREFIX = '/uploads/emojis/';

export interface EmojiRow {
  id: string;
  shortcode: string;
  name: string;
  category: string;
  url: string;
  position: number;
}

/** Turn a file name into a shortcode suggestion: `Party Parrot.gif` → `party_parrot`. */
export function shortcodeFromFilename(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, '').toLowerCase()
    .replace(/[^a-z0-9_+-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
}

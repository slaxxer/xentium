/**
 * Smiley codes → emoji.
 *
 * Every old board drew `:)` as a little picture of its own, and our importers keep the
 * code itself (an image would point at the old site). Here the common codes become the
 * Unicode emoji they meant, which every device draws and our editor keeps as text.
 *
 * Only a code standing on its own counts: after a space or the start, before a space,
 * punctuation or the end. So `http://`, `12:30` and `foo:)` stay as written, and code
 * blocks and links are never touched (see editorHtml.ts). `8)` and `B)` are left alone
 * on purpose: they are list items and grades far more often than sunglasses.
 */
const SMILEYS: Record<string, string> = {
  ":)": "🙂", ":-)": "🙂", "(:": "🙂", ":(": "🙁", ":-(": "🙁",
  ";)": "😉", ";-)": "😉", ":D": "😄", ":-D": "😄", "xD": "😆", "XD": "😆",
  ":P": "😛", ":p": "😛", ":-P": "😛", ":-p": "😛",
  ":o": "😮", ":O": "😮", ":-o": "😮", ":-O": "😮",
  ":|": "😐", ":-|": "😐", ":/": "😕", ":-/": "😕", ":?": "😕",
  ":'(": "😢", ":@": "😠", ":x": "😠", "<3": "❤️", "^^": "😊", "^_^": "😊", "-_-": "😑",
  ":lol:": "😂", ":cool:": "😎", ":mad:": "😠", ":rolleyes:": "🙄", ":roll:": "🙄",
  ":eek:": "😮", ":shock:": "😲", ":oops:": "😳", ":cry:": "😢", ":evil:": "😈", ":twisted:": "😈",
  ":wink:": "😉", ":smile:": "🙂", ":sad:": "🙁", ":biggrin:": "😄", ":razz:": "😛", ":mrgreen:": "😁",
  ":confused:": "😕", ":geek:": "🤓", ":ugeek:": "🤓", ":idea:": "💡", ":arrow:": "➡️", ":?:": "❓", ":!:": "❗",
  ":thumbsup:": "👍", ":thumbsdown:": "👎", ":thumbup:": "👍", ":thumbdown:": "👎", ":heart:": "❤️",
  ":laugh:": "😂", ":tongue:": "😛", ":unsure:": "😕", ":blush:": "😊", ":angry:": "😠", ":sleep:": "😴",
};

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PATTERN = new RegExp(
  `(?<=^|[\\s(>"'])(${Object.keys(SMILEYS).sort((a, b) => b.length - a.length).map(escRe).join("|")})(?=$|[\\s.,!?;)\\]"'])`,
  "g",
);

/** Plain text in, the same text with smiley codes as emoji. */
export function smileysToEmoji(text: string): string {
  return text.replace(PATTERN, (code) => SMILEYS[code] ?? code);
}

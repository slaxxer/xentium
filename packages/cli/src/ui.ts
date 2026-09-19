/**
 * Terminal output. No dependency — a CLI that prints a few coloured lines does
 * not need one, and every dependency here is one more thing a server installs
 * before it has anything.
 */
import type { Check, CheckStatus } from "./checks.js";

const useColor =
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== "dumb" &&
  process.stdout.isTTY === true;

const wrap = (code: number) => (s: string) => (useColor ? `\u001b[${code}m${s}\u001b[0m` : s);

export const color = {
  bold:  wrap(1),
  dim:   wrap(2),
  red:   wrap(31),
  green: wrap(32),
  amber: wrap(33),
  blue:  wrap(36),
};

export const symbol: Record<CheckStatus, string> = {
  ok:   color.green("✓"),
  warn: color.amber("!"),
  fail: color.red("✗"),
};

export function heading(text: string): void {
  process.stdout.write(`\n${color.bold(text)}\n`);
}

export function line(text = ""): void {
  process.stdout.write(`${text}\n`);
}

export function info(text: string): void {
  line(`  ${text}`);
}

export function note(text: string): void {
  line(color.dim(`  ${text}`));
}

export function success(text: string): void {
  line(`${color.green("✓")} ${text}`);
}

export function warning(text: string): void {
  line(`${color.amber("!")} ${text}`);
}

export function error(text: string): void {
  process.stderr.write(`${color.red("✗")} ${text}\n`);
}

/** A status line whose label column lines up with the others. */
export function field(label: string, value: string, width = 14): void {
  line(`  ${color.dim(label.padEnd(width))} ${value}`);
}

export function printChecks(checks: Check[]): void {
  const width = Math.max(...checks.map((c) => c.name.length)) + 2;
  for (const check of checks) {
    line(`  ${symbol[check.status]} ${check.name.padEnd(width)} ${check.status === "ok" ? color.dim(check.detail) : check.detail}`);
    if (check.fix && check.status !== "ok") line(`    ${color.dim("→")} ${color.blue(check.fix)}`);
  }
}

/**
 * The wordmark, the same one that heads xentium.sh. String.raw because the
 * drawing is mostly backslashes.
 *
 * It is 75 columns wide, so a narrow terminal gets the name instead of five
 * lines of wreckage.
 */
const WORDMARK = String.raw`
   __  __     ______     __   __     ______   __     __  __     __    __
  /\_\_\_\   /\  ___\   /\ "-.\ \   /\__  _\ /\ \   /\ \/\ \   /\ "-./  \
  \/_/\_\/_  \ \  __\   \ \ \-.  \  \/_/\ \/ \ \ \  \ \ \_\ \  \ \ \-./\ \
    /\_\/\_\  \ \_____\  \ \_\\"\_\    \ \_\  \ \_\  \ \_____\  \ \_\ \ \_\
    \/_/\/_/   \/_____/   \/_/ \/_/     \/_/   \/_/   \/_____/   \/_/  \/_/
`;

export function logo(subtitle?: string): void {
  const width = process.stdout.columns ?? 80;
  line();
  // Only the surrounding blank lines come off: trim() would eat the first
  // line's indent and shear the X off the top row.
  if (width >= 78) line(color.blue(WORDMARK.replace(/^\n|\n$/g, "")));
  else line(`  ${color.bold("Xentium")}`);
  line();
  if (subtitle) {
    line(color.dim(`  ${subtitle}`));
    line();
  }
}

/** Anything written to stdout while `--json` is on would corrupt the output. */
export function json(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

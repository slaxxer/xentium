/**
 * The three questions an installer ever asks: type something, yes or no, pick
 * one. Built on node:readline so `npm create xentium` pulls in nothing to ask
 * them with.
 *
 * With --yes, or when there is no terminal to ask in (a script, a pipe, the
 * shell installer), every question answers itself with its default. A question
 * that has no default in that mode is a bug in the caller, and says so.
 */
import { createInterface, type Interface } from "node:readline/promises";
import { color, line } from "../../cli/src/ui.js";

let rl: Interface | null = null;
let auto = false;

/** Answer every question with its default from here on. */
export function setAutomatic(value: boolean): void {
  auto = value;
}

export function isAutomatic(): boolean {
  return auto || !process.stdin.isTTY;
}

function io(): Interface {
  rl ??= createInterface({ input: process.stdin, output: process.stdout });
  return rl;
}

export function closePrompts(): void {
  rl?.close();
  rl = null;
}

function defaulted<T>(question: string, shown: string, value: T): T {
  line(`${color.dim("?")} ${question} ${color.dim(shown)}`);
  return value;
}

export async function ask(question: string, fallback?: string): Promise<string> {
  if (isAutomatic()) {
    if (fallback === undefined) throw new Error(`"${question}" has no answer and there is no terminal to ask in.`);
    return defaulted(question, fallback, fallback);
  }
  const suffix = fallback ? color.dim(` (${fallback})`) : "";
  const answer = (await io().question(`${color.blue("?")} ${question}${suffix} `)).trim();
  if (answer) return answer;
  if (fallback !== undefined) return fallback;
  return ask(question, fallback);
}

export async function confirm(question: string, fallback = true): Promise<boolean> {
  if (isAutomatic()) return defaulted(question, fallback ? "yes" : "no", fallback);
  const suffix = color.dim(fallback ? " (Y/n)" : " (y/N)");
  const answer = (await io().question(`${color.blue("?")} ${question}${suffix} `)).trim().toLowerCase();
  if (!answer) return fallback;
  return answer.startsWith("y");
}

export interface Choice<T> { value: T; label: string; hint?: string }

export async function choose<T>(question: string, choices: Array<Choice<T>>, fallbackIndex = 0): Promise<T> {
  const fallback = choices[fallbackIndex]!;
  if (isAutomatic()) return defaulted(question, fallback.label, fallback.value);

  line(`${color.blue("?")} ${question}`);
  choices.forEach((choice, i) => {
    const marker = i === fallbackIndex ? color.bold(`${i + 1})`) : `${i + 1})`;
    line(`  ${marker} ${choice.label}${choice.hint ? color.dim(` — ${choice.hint}`) : ""}`);
  });
  const answer = (await io().question(`  ${color.dim(`1-${choices.length}`)} (${fallbackIndex + 1}) `)).trim();
  if (!answer) return fallback.value;
  const index = Number.parseInt(answer, 10) - 1;
  if (index >= 0 && index < choices.length) return choices[index]!.value;
  return choose(question, choices, fallbackIndex);
}

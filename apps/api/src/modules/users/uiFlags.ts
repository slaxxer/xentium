/**
 * Per-person UI flags: small facts the interface remembers for one person across
 * browsers, like a guided tour already seen or the layout editor's Advanced mode.
 * Present = on. A person reads and writes only their own; nothing else uses them.
 */
import type { RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "../../infrastructure/db.js";

/** `area:name`, lower-case. Bounded so the list cannot grow without limit. */
const flagSchema = z.string().regex(/^[a-z0-9-]{1,32}:[a-z0-9-]{1,48}$/);
const MAX_FLAGS = 64;

export async function getUiFlags(userId: string): Promise<string[]> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { uiFlags: true } });
  return user?.uiFlags ?? [];
}

export async function setUiFlag(userId: string, flag: string, on: boolean): Promise<string[]> {
  const current = await getUiFlags(userId);
  const next = on
    ? (current.includes(flag) ? current : [...current, flag].slice(-MAX_FLAGS))
    : current.filter((f) => f !== flag);
  if (next !== current) await prisma.user.update({ where: { id: userId }, data: { uiFlags: next } });
  return next;
}

export const uiFlagsController = {
  list: (async (req, res) => {
    res.json({ flags: await getUiFlags(req.userId!) });
  }) as RequestHandler,

  set: (async (req, res) => {
    const { flag } = z.object({ flag: flagSchema }).parse(req.params);
    const { on } = z.object({ on: z.boolean() }).parse(req.body);
    res.json({ flags: await setUiFlag(req.userId!, flag, on) });
  }) as RequestHandler,
};

/**
 * Theme Studio: one theme's two drafts — its LAYOUTS and its STYLES (tokens) — read
 * and published together.
 *
 * They were two staging areas with two Publish buttons, and an admin who redesigned a
 * page and recoloured it to match could put one half live without the other. The
 * Studio publishes both, always: a new arrangement and the colours it was designed
 * with go out at once. The scheduled publish job does the same.
 *
 * The style draft has three parts: tokens, the font (counted with the tokens, it is
 * the same "Colours & type" mode) and custom CSS (its own count). Branding is not
 * drafted.
 */
import type { LayoutSelector, ScopedTokenSet, UserRef } from "@xentium/contracts";
import { prisma } from "../../infrastructure/db.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { XEC } from "../../shared/errors/xec.js";
import { USER_REF_SELECT, toUserRef } from "../../shared/utils/userRef.js";
import { appearanceService } from "../appearance/appearance.service.js";
import { layoutService, type PublishedRowSnapshot } from "../layouts/layout.service.js";
import type { ThemeKey } from "./themeKey.js";

export interface StudioStatus {
  /** Layout documents (and the site frame) whose draft differs from live. */
  layouts: LayoutSelector[];
  /** Token values (and the font, as one) that differ between the style draft and live. */
  styleChanges: number;
  /** The staged custom CSS differs from live. */
  cssPending: boolean;
  pending: boolean;
}

/** How many token values differ between two scoped sets — added, changed or removed. */
export function countTokenChanges(draft: ScopedTokenSet, live: ScopedTokenSet): number {
  let n = 0;
  for (const scope of new Set([...Object.keys(draft), ...Object.keys(live)])) {
    const a = draft[scope] ?? {};
    const b = live[scope] ?? {};
    for (const v of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[v] !== b[v]) n++;
  }
  return n;
}

export async function studioStatus(key: ThemeKey): Promise<StudioStatus> {
  const [layouts, styles] = await Promise.all([
    layoutService.getDraftStatus(key),
    appearanceService.getDraftStatus(key),
  ]);
  const tokenChanges = styles.tokens
    ? Math.max(1, countTokenChanges(
        await appearanceService.getDraftTokens(key),
        await appearanceService.getTokenOverrides(key),
      ))
    : 0;
  return {
    layouts: layouts.pending,
    styleChanges: tokenChanges + (styles.font ? 1 : 0),
    cssPending: styles.css,
    pending: layouts.pending.length > 0 || styles.pending,
  };
}

/** Who a publish is attributed to when nobody pressed the button (the schedule). */
async function anyAdminId(): Promise<string | undefined> {
  const admin = await prisma.user.findFirst({
    where: { groups: { some: { group: { key: "admin" } } } },
    select: { id: true },
  });
  return admin?.id;
}

// ── History ─────────────────────────────────────────────────────────────────
// One timeline per theme. Every Studio publish (the button or the schedule) records a
// REVISION: the theme's whole published state right after it, plus what changed. Older
// colour-only entries (`xcf_style_history` — a colourway applied from the Themes page,
// anything from before revisions existed) are listed in the same timeline.
//
// Restoring never goes live. It stages the entry as the theme's draft, so it is seen in
// the previews and goes out with the one Publish, like any other change.

/** Revisions kept per theme. */
const REVISIONS_KEPT = 30;

export interface RevisionChanges { layouts: LayoutSelector[]; tokens: number; css: boolean; font: boolean }

export interface HistoryEntry {
  id: string;
  kind: "revision" | "colours";
  label: string;
  createdAt: string;
  savedBy: UserRef | null;
  /** Revisions only: what that publish changed. */
  changes?: RevisionChanges;
}

const notFound = () => new XentiumError({
  code: XEC.API_NOT_FOUND, httpStatus: 404, message: "No such history entry for this theme.",
});

const SAVED_BY = { select: USER_REF_SELECT } as const;

/** Record one publish. `changes` is read BEFORE publishing — afterwards nothing differs. */
async function recordRevision(key: ThemeKey, userId: string | undefined, label: string | undefined, changes: RevisionChanges): Promise<void> {
  const [tokens, customCss, font, layouts] = await Promise.all([
    appearanceService.getTokenOverrides(key),
    appearanceService.getCustomCss(key),
    appearanceService.getFont(key),
    layoutService.snapshotPublished(key),
  ]);
  await prisma.themeRevision.create({
    data: {
      themeKey: key,
      label: label ?? "",
      changes: changes as unknown as object,
      tokens: tokens as unknown as object,
      customCss,
      font: font as unknown as object,
      layouts: layouts as unknown as object,
      savedById: userId ?? null,
    },
  });
  const old = await prisma.themeRevision.findMany({
    where: { themeKey: key }, orderBy: { createdAt: "desc" }, skip: REVISIONS_KEPT, select: { id: true },
  });
  if (old.length) await prisma.themeRevision.deleteMany({ where: { id: { in: old.map((r) => r.id) } } });
}

/**
 * Publish one theme's layouts and styles together, and record it in History.
 *
 * Layouts first, styles second: each half is its own transaction, so a failure in the
 * second leaves the first live and the error reported — the next Publish finishes it.
 */
export async function publishTheme(
  userId: string | undefined, key: ThemeKey, label?: string,
): Promise<{ layouts: LayoutSelector[]; styles: boolean }> {
  const [status, styles] = await Promise.all([studioStatus(key), appearanceService.getDraftStatus(key)]);
  const author = userId ?? (await anyAdminId());
  const layouts = author ? (await layoutService.publish(author, key)).published : [];
  const published = await appearanceService.publishDraft(userId, label, key, { history: false });
  if (layouts.length || published) {
    await recordRevision(key, author, label, {
      layouts,
      tokens: styles.tokens ? status.styleChanges - (styles.font ? 1 : 0) : 0,
      css: styles.css,
      font: styles.font,
    });
  }
  return { layouts, styles: published };
}

/** The timeline, newest first. */
export async function themeHistory(key: ThemeKey): Promise<HistoryEntry[]> {
  const [revisions, colours] = await Promise.all([
    prisma.themeRevision.findMany({
      where: { themeKey: key }, orderBy: { createdAt: "desc" },
      select: { id: true, label: true, createdAt: true, changes: true, savedBy: SAVED_BY },
    }),
    prisma.styleHistory.findMany({
      where: { themeKey: key }, orderBy: { createdAt: "desc" },
      select: { id: true, label: true, createdAt: true, savedBy: SAVED_BY },
    }),
  ]);
  return [
    ...revisions.map((r): HistoryEntry => ({
      id: r.id, kind: "revision", label: r.label, createdAt: r.createdAt.toISOString(),
      savedBy: r.savedBy ? toUserRef(r.savedBy) : null, changes: r.changes as unknown as RevisionChanges,
    })),
    ...colours.map((c): HistoryEntry => ({
      id: c.id, kind: "colours", label: c.label, createdAt: c.createdAt.toISOString(), savedBy: toUserRef(c.savedBy),
    })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Stage a History entry as the theme's draft. A revision brings back everything it
 * holds; a colour entry, its colours. Refuses an entry of another theme — `key` is
 * the theme the Studio is editing, and restoring across themes would be a surprise.
 */
export async function stageHistoryEntry(kind: HistoryEntry["kind"], id: string, userId: string, key: ThemeKey): Promise<void> {
  if (kind === "colours") {
    const entry = await appearanceService.historyTokens(id).catch(() => null);
    if (!entry || entry.themeKey !== key) throw notFound();
    await appearanceService.saveDraftTokens(entry.tokens, userId, key);
    return;
  }
  const rev = await prisma.themeRevision.findFirst({ where: { id, themeKey: key } });
  if (!rev) throw notFound();
  await appearanceService.saveDraftTokens(rev.tokens as unknown as ScopedTokenSet, userId, key);
  await appearanceService.saveDraftCustomCss(rev.customCss, key);
  await appearanceService.saveDraftFont(rev.font as { family?: string; weight?: string; size?: string }, key);
  await layoutService.stageSnapshot(rev.layouts as unknown as PublishedRowSnapshot[], userId, key);
}

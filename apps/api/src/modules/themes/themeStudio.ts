/**
 * Theme Studio: one theme's two drafts — its LAYOUTS and its STYLES (tokens) — read
 * and published together.
 *
 * They were two staging areas with two Publish buttons, and an admin who redesigned a
 * page and recoloured it to match could put one half live without the other. The
 * Studio publishes both, always: a new arrangement and the colours it was designed
 * with go out at once. The scheduled publish job does the same.
 *
 * Fonts, custom CSS and branding are not drafted (they save live), so they are not
 * part of either count.
 */
import type { LayoutSelector, ScopedTokenSet } from "@xentium/contracts";
import { prisma } from "../../infrastructure/db.js";
import { appearanceService } from "../appearance/appearance.service.js";
import { layoutService } from "../layouts/layout.service.js";
import type { ThemeKey } from "./themeKey.js";

export interface StudioStatus {
  /** Layout documents (and the site frame) whose draft differs from live. */
  layouts: LayoutSelector[];
  /** Token values that differ between the style draft and live. */
  styleChanges: number;
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
  const styleChanges = styles.pending
    ? Math.max(1, countTokenChanges(
        await appearanceService.getDraftTokens(key),
        await appearanceService.getTokenOverrides(key),
      ))
    : 0;
  return { layouts: layouts.pending, styleChanges, pending: layouts.pending.length > 0 || styles.pending };
}

/** Who a publish is attributed to when nobody pressed the button (the schedule). */
async function anyAdminId(): Promise<string | undefined> {
  const admin = await prisma.user.findFirst({
    where: { groups: { some: { group: { key: "admin" } } } },
    select: { id: true },
  });
  return admin?.id;
}

/**
 * Publish one theme's layouts and styles together.
 *
 * Layouts first, styles second: each half is its own transaction, so a failure in the
 * second leaves the first live and the error reported — the next Publish finishes it.
 */
export async function publishTheme(
  userId: string | undefined, key: ThemeKey, label?: string,
): Promise<{ layouts: LayoutSelector[]; styles: boolean }> {
  const author = userId ?? (await anyAdminId());
  const layouts = author ? (await layoutService.publish(author, key)).published : [];
  const styles = await appearanceService.publishDraft(userId, label, key);
  return { layouts, styles };
}

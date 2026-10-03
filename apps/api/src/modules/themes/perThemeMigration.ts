/**
 * One-time carry-over to per-theme appearance.
 *
 * Before this, a site had ONE layer of edits — layouts, tokens, custom CSS, fonts and
 * the site frame — sitting over whichever theme was active, plus a copy of that
 * theme's package in "theme layer" settings and `theme`-scope layout rows. Now every
 * theme carries its own edits, and a theme's package is read from its library row.
 *
 * So the existing layer belongs to the theme that was ACTIVE when this runs (or to
 * Core, when none was): the live site looks exactly as it did, and every other
 * installed theme starts as its package shipped it.
 *
 * Same guarantees as the layout migrations beside it: flag-guarded (a restart is a
 * no-op), one transaction (all or nothing), and a failure is logged, not fatal.
 */
import { prisma } from "../../infrastructure/db.js";
import { bustSettingsCache, getFreshSetting } from "../../shared/utils/settings.js";
import { logger } from "../../infrastructure/logging/logger.js";
import { ACTIVE_THEME_SETTING, themed } from "./themeKey.js";

export const PER_THEME_MIGRATED = "appearance.perThemeMigrated";

/** The admin layer's keys, with the pre-collapse name each falls back to. */
const MOVED: [current: string, legacy?: string][] = [
  ["appearance.tokens", "appearance.tokens.light"],
  ["appearance.tokens.draft", "appearance.tokens.draft.light"],
  ["appearance.tokens.draft.by"],
  ["appearance.custom_css_light", "appearance.custom_css"],
  ["appearance.font.family"],
  ["appearance.font.weight"],
  ["appearance.font.size"],
];

/** The old copy of the active theme's package, and everything else that is now derived. */
const RETIRED = [
  "appearance.tokens.theme", "appearance.tokens.theme.light",
  "appearance.tokens.theme.draft", "appearance.tokens.theme.draft.light",
  "appearance.custom_css.theme", "appearance.custom_css.theme.light",
  "appearance.custom_css.theme.draft", "appearance.custom_css.theme.draft.light",
  "appearance.tokens.dark", "appearance.tokens.draft.dark", "appearance.custom_css_dark",
  "appearance.custom_css_compiled",
  // The undo point described layers that no longer exist.
  "appearance.theme.rollback",
];

export async function migrateToPerThemeAppearance(): Promise<void> {
  if (await getFreshSetting<boolean>(PER_THEME_MIGRATED, false)) return;

  const active = await getFreshSetting<Record<string, unknown> | null>(ACTIVE_THEME_SETTING, null);
  const activeId = active?.id ? String(active.id) : "";

  const settings = await prisma.setting.findMany({
    where: { key: { in: [...MOVED.flatMap(([c, l]) => (l ? [c, l] : [c])), ...RETIRED] } },
  });
  const value = (key: string) => settings.find((s) => s.key === key)?.value;

  await prisma.$transaction(async (tx) => {
    /*
     * A theme applied before the library existed has no row — its package lived only
     * in the theme-layer settings and `theme` rows, which are about to go. Give it one
     * from exactly those, or the site would lose its theme.
     */
    if (activeId && !(await tx.theme.findUnique({ where: { id: activeId }, select: { id: true } }))) {
      const themeRows = await tx.layout.findMany({ where: { scope: "theme", variant: "" } });
      const documents: Record<string, unknown> = {};
      let frame: unknown = null;
      for (const r of themeRows) {
        if (r.templateKey === "@site-frame") frame = r.document;
        else documents[r.templateKey] = r.document;
      }
      await tx.theme.create({
        data: {
          id:       activeId,
          name:     String(active!.name ?? activeId),
          version:  String(active!.version ?? "0.0.0"),
          vendor:   String(active!.vendor ?? ""),
          manifest: active as object,
          payload:  {
            documents,
            tokens:    (value("appearance.tokens.theme") ?? value("appearance.tokens.theme.light") ?? null) as object,
            customCss: (value("appearance.custom_css.theme") ?? value("appearance.custom_css.theme.light") ?? null) as string,
            frame,
          } as object,
          active: true,
        },
      });
    }

    // The packaged copies: a theme's baseline is its library row now.
    await tx.layout.deleteMany({ where: { scope: "theme" } });

    if (activeId) {
      // The site's arrangement was made on the active theme, so it is that theme's.
      await tx.layout.updateMany({ where: { themeKey: "" }, data: { themeKey: activeId } });
      await tx.styleHistory.updateMany({ where: { themeKey: "" }, data: { themeKey: activeId } });

      for (const [current, legacy] of MOVED) {
        const v = value(current) ?? (legacy ? value(legacy) : undefined);
        if (v === undefined || v === null) continue;
        const to = themed(current, activeId);
        await tx.setting.upsert({ where: { key: to }, update: { value: v as object }, create: { key: to, value: v as object } });
      }
      // Core starts fresh: what was here belonged to the active theme.
      await tx.setting.deleteMany({
        where: { key: { in: MOVED.flatMap(([c, l]) => (l ? [c, l] : [c])) } },
      });
    }

    await tx.setting.deleteMany({ where: { key: { in: RETIRED } } });
    await tx.setting.upsert({
      where:  { key: PER_THEME_MIGRATED },
      update: { value: true },
      create: { key: PER_THEME_MIGRATED, value: true },
    });
  });

  for (const s of settings) bustSettingsCache(s.key);
  bustSettingsCache(PER_THEME_MIGRATED);
  logger.info({ activeTheme: activeId || "core" }, "Appearance moved to per-theme storage");
}

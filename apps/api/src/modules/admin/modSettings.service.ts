/**
 * ACP → Moderation → Mod Settings: the one read and the one write behind the page.
 *
 * The page used to PUT each field through the generic settings endpoint, which
 * validates nothing — so a ladder or a ban range was whatever the browser sent.
 * Here every field is checked, and an impossible range is refused outright.
 */
import { z } from "zod";
import { prisma } from "../../infrastructure/db.js";
import { bustSettingsCache, getSettings } from "../../shared/utils/settings.js";
import { securityScanRegistry } from "../../core/security/security-scan-registry.js";
import { getModPolicy } from "../moderation/moderationPolicy.js";

/** The four baseline patterns, in the order the page lists them. */
export const PATTERN_TYPES = [
  "rapid_login_attempts", "multi_account_suspicion", "registration_burst", "ban_evasion_suspicion",
] as const;
type PatternType = (typeof PATTERN_TYPES)[number];

const MAX_STEPS = 10;

const stepSchema = z.object({
  warningCount:     z.number().int().min(1).max(100),
  action:           z.enum(["notify", "ban_temporary", "ban_permanent"]),
  banDays:          z.number().int().min(1).max(3650).optional(),
  notifyModerators: z.boolean(),
}).refine((s) => s.action !== "ban_temporary" || s.banDays !== undefined, { message: "A temporary ban needs a length" });

const days = z.number().int().min(1).max(3650);

export const modSettingsPatchSchema = z.object({
  ladder:        z.array(stepSchema).max(MAX_STEPS)
    // Two steps on one count would both claim the same warning; only one could run.
    .refine((l) => new Set(l.map((s) => s.warningCount)).size === l.length, { message: "Two steps share a warning count" })
    .optional(),
  bans:          z.object({ defaultDays: days, minDays: days, maxDays: days, allowOverride: z.boolean() })
    .refine((b) => b.minDays <= b.maxDays, { message: "The minimum is longer than the maximum" })
    .refine((b) => b.defaultDays >= b.minDays && b.defaultDays <= b.maxDays, { message: "The default is outside the range" })
    .optional(),
  resetAfterBan: z.boolean().optional(),
  patterns:      z.partialRecord(z.enum(PATTERN_TYPES), z.boolean()).optional(),
}).strict();

export type ModSettingsPatch = z.infer<typeof modSettingsPatchSchema>;

const patternKey = (t: PatternType) => `security.pattern.${t}`;

async function write(entries: [string, unknown][]) {
  await prisma.$transaction(entries.map(([key, value]) => prisma.setting.upsert({
    where: { key }, update: { value: value as object }, create: { key, value: value as object },
  })));
  for (const [key] of entries) bustSettingsCache(key);
}

export const modSettingsService = {
  async get() {
    const policy = await getModPolicy();
    const toggles = await getSettings(Object.fromEntries(PATTERN_TYPES.map((t) => [patternKey(t), true])) as Record<string, unknown>);

    const since = new Date(Date.now() - 7 * 86_400_000);
    const [counts, plugins] = await Promise.all([
      prisma.moderationCase.groupBy({ by: ["type"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
      prisma.installedPlugin.findMany({ select: { id: true, name: true } }),
    ]);
    const countOf = new Map(counts.map((c) => [c.type, c._count._all]));
    const nameOf = new Map(plugins.map((p) => [p.id, p.name]));

    return {
      // Absent notifyModerators on an older row reads as on — what the engine does.
      ladder: policy.ladder.map((s) => ({ ...s, notifyModerators: s.notifyModerators !== false })),
      bans: policy.bans,
      resetAfterBan: policy.resetAfterBan,
      patterns: PATTERN_TYPES.map((type) => {
        const pluginId = securityScanRegistry.claimant(type);
        return {
          type,
          enabled: toggles[patternKey(type)] !== false,
          // A plugin that claims a pattern replaces the baseline; the toggle here then does nothing.
          claimedBy: pluginId ? { id: pluginId, name: nameOf.get(pluginId) ?? pluginId } : null,
          casesLast7d: countOf.get(type) ?? 0,
        };
      }),
    };
  },

  /** Writes only what the patch carries — two tabs editing different sections must not undo each other. */
  async update(patch: ModSettingsPatch) {
    const entries: [string, unknown][] = [];
    if (patch.ladder) {
      const thresholds = [...patch.ladder]
        .sort((a, b) => a.warningCount - b.warningCount)
        // A length only means something on a temporary ban.
        .map((s) => (s.action === "ban_temporary" ? s : { ...s, banDays: undefined }));
      entries.push(["moderation.policy", { thresholds: JSON.parse(JSON.stringify(thresholds)) }]);
    }
    if (patch.bans) {
      entries.push(
        ["moderation.default_ban_days", patch.bans.defaultDays],
        ["moderation.min_ban_days", patch.bans.minDays],
        ["moderation.max_ban_days", patch.bans.maxDays],
        ["moderation.ban_allow_override", patch.bans.allowOverride],
      );
    }
    if (patch.resetAfterBan !== undefined) entries.push(["moderation.reset_count_after_ban", patch.resetAfterBan]);
    for (const [type, on] of Object.entries(patch.patterns ?? {})) entries.push([patternKey(type as PatternType), on]);

    if (entries.length) await write(entries);
    return this.get();
  },
};

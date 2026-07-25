import { z } from "zod";

export const updateGroupProgressionSchema = z.object({
  isProgressionGroup:       z.boolean().optional(),
  ladderPosition:           z.number().int().positive().nullable().optional(),
  promoteFromGroupId:       z.string().nullable().optional(),

  // Core thresholds (plugin thresholds — e.g. the forum's — are owned by the plugin)
  minArticles:              z.number().int().min(0).nullable().optional(),
  minComments:              z.number().int().min(0).nullable().optional(),
  minDaysMember:            z.number().int().min(0).nullable().optional(),
  minLikesReceived:         z.number().int().min(0).nullable().optional(),

  // Core content limits
  maxArticleLength:         z.number().int().min(0).nullable().optional(),
  maxDailyArticles:         z.number().int().min(0).nullable().optional(),
  maxCommentLength:         z.number().int().min(0).nullable().optional(),
  maxDailyComments:         z.number().int().min(0).nullable().optional(),
  maxAttachments:           z.number().int().min(0).nullable().optional(),

  // Profile image limits
  maxProfileImageBytes:     z.number().int().min(0).nullable().optional(),
  allowedProfileImageTypes: z.array(z.string()).optional(),

  // Badge
  badgeLabel:               z.string().max(40).nullable().optional(),
  badgeColor:               z.string().max(20).nullable().optional(),
  badgeTextShadow:          z.boolean().optional(),
  badgeShadowColor:         z.string().max(20).nullable().optional(),
  badgeShadowX:             z.number().int().min(-20).max(20).optional(),
  badgeShadowY:             z.number().int().min(-20).max(20).optional(),
  badgeShadowBlur:          z.number().int().min(0).max(60).optional(),
});

export const globalProgressionSettingsSchema = z.object({
  enabled:          z.boolean().optional(),
  notifyOnPromote:  z.boolean().optional(),
  showProgressBar:  z.boolean().optional(),
  thresholdLogic:   z.enum(["and", "or"]).optional(),
});

export type UpdateGroupProgressionInput = z.infer<typeof updateGroupProgressionSchema>;
export type GlobalProgressionSettingsInput = z.infer<typeof globalProgressionSettingsSchema>;

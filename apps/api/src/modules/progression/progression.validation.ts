import { z } from "zod";

export const updateGroupProgressionSchema = z.object({
  isProgressionGroup:       z.boolean().optional(),
  ladderPosition:           z.number().int().positive().nullable().optional(),
  promoteFromGroupId:       z.string().nullable().optional(),

  // Thresholds
  minPosts:                 z.number().int().min(0).nullable().optional(),
  minThreads:               z.number().int().min(0).nullable().optional(),
  minDaysMember:            z.number().int().min(0).nullable().optional(),
  minLikesReceived:         z.number().int().min(0).nullable().optional(),

  // Content limits
  maxPostLength:            z.number().int().min(0).nullable().optional(),
  maxDailyPosts:            z.number().int().min(0).nullable().optional(),
  maxAttachments:           z.number().int().min(0).nullable().optional(),

  // Profile image limits
  maxProfileImageBytes:     z.number().int().min(0).nullable().optional(),
  allowedProfileImageTypes: z.array(z.string()).optional(),

  // Badge
  badgeLabel:               z.string().max(40).nullable().optional(),
  badgeColor:               z.string().max(20).nullable().optional(),
});

export const globalProgressionSettingsSchema = z.object({
  enabled:          z.boolean().optional(),
  notifyOnPromote:  z.boolean().optional(),
  showProgressBar:  z.boolean().optional(),
  thresholdLogic:   z.enum(["and", "or"]).optional(),
});

export type UpdateGroupProgressionInput = z.infer<typeof updateGroupProgressionSchema>;
export type GlobalProgressionSettingsInput = z.infer<typeof globalProgressionSettingsSchema>;

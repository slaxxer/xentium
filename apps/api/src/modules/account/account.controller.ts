import type { RequestHandler } from "express";
import { accountService } from "./account.service.js";
import {
  updateProfileSchema,
  changeUsernameSchema,
  changePasswordSchema,
  changeEmailSchema,
  verifyEmailCodeSchema,
  privacySettingsSchema,
  revokeSessionSchema,
  profileFieldValuesSchema,
  setPinSchema,
  disablePinSchema,
  notificationPreferencesSchema,
  badgeVisibilitySchema,
} from "./account.validation.js";

const wrap =
  (fn: RequestHandler): RequestHandler =>
  async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      next(err);
    }
  };

export const accountController = {
  uploadAvatar: wrap(async (req, res) => {
    const userId = (req as any).userId as string;
    const file = req.file!;
    const ext = (file as { detectedExt?: string }).detectedExt ?? "jpg";
    const url = await accountService.uploadAvatar(userId, file.buffer, ext);
    res.json({ url });
  }),

  updateProfile: wrap(async (req, res) => {
    const userId = (req as any).userId as string;
    const data = updateProfileSchema.parse(req.body);
    const updated = await accountService.updateProfile(userId, data);
    res.json(updated);
  }),

  changeUsername: wrap(async (req, res) => {
    const userId = (req as any).userId as string;
    const { username } = changeUsernameSchema.parse(req.body);
    const result = await accountService.changeUsername(userId, username);
    res.json(result);
  }),

  requestEmailChange: wrap(async (req, res) => {
    const userId = (req as any).userId as string;
    const { currentPassword, newEmail } = changeEmailSchema.parse(req.body);
    const result = await accountService.requestEmailChange(userId, currentPassword, newEmail);
    res.json(result);
  }),

  verifyEmailCode: wrap(async (req, res) => {
    const userId = (req as any).userId as string;
    const { code } = verifyEmailCodeSchema.parse(req.body);
    const result = await accountService.verifyEmailCode(userId, code);
    res.json(result);
  }),

  changePassword: wrap(async (req, res) => {
    const userId = (req as any).userId as string;
    const sessionId = (req as any).sessionId as string | undefined;
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    await accountService.changePassword(userId, currentPassword, newPassword, sessionId);
    res.status(204).send();
  }),

  getSessions: wrap(async (req, res) => {
    const userId = (req as any).userId as string;
    const sessions = await accountService.getSessions(userId);
    res.json(sessions);
  }),

  revokeSession: wrap(async (req, res) => {
    const userId = (req as any).userId as string;
    const { sessionId } = revokeSessionSchema.parse(req.params);
    await accountService.revokeSession(userId, sessionId);
    res.status(204).send();
  }),

  getPrivacy: wrap(async (req, res) => {
    const userId = (req as any).userId as string;
    const settings = await accountService.getPrivacySettings(userId);
    res.json(settings);
  }),

  updatePrivacy: wrap(async (req, res) => {
    const userId = (req as any).userId as string;
    const data = privacySettingsSchema.parse(req.body);
    const updated = await accountService.updatePrivacySettings(userId, data as any);
    res.json(updated);
  }),

  getUsernameHistory: wrap(async (req, res) => {
    const userId = (req as any).userId as string;
    const history = await accountService.getUsernameHistory(userId);
    res.json(history);
  }),

  getProfileFieldValues: wrap(async (req, res) => {
    const userId = (req as any).userId as string;
    const fields = await accountService.getProfileFieldValues(userId);
    res.json(fields);
  }),

  updateProfileFieldValues: wrap(async (req, res) => {
    const userId = (req as any).userId as string;
    const { values } = profileFieldValuesSchema.parse(req.body);
    const result = await accountService.updateProfileFieldValues(userId, values);
    res.json(result);
  }),

  setPin: wrap(async (req, res) => {
    const userId = (req as any).userId as string;
    const { currentPassword, pin } = setPinSchema.parse(req.body);
    await accountService.setLoginPin(userId, currentPassword, pin);
    res.status(204).send();
  }),

  disablePin: wrap(async (req, res) => {
    const userId = (req as any).userId as string;
    const { currentPassword } = disablePinSchema.parse(req.body);
    await accountService.disableLoginPin(userId, currentPassword);
    res.status(204).send();
  }),
  getNotificationPreferences: wrap(async (req, res) => {
    const userId = (req as any).userId as string;
    res.json(await accountService.getNotificationPreferences(userId));
  }),

  updateNotificationPreferences: wrap(async (req, res) => {
    const userId = (req as any).userId as string;
    const prefs  = notificationPreferencesSchema.parse(req.body);
    res.json(await accountService.updateNotificationPreferences(userId, prefs as any));
  }),

  getBadgeVisibility: wrap(async (req, res) => {
    const userId = (req as any).userId as string;
    res.json(await accountService.getBadgeVisibility(userId));
  }),

  updateBadgeVisibility: wrap(async (req, res) => {
    const userId = (req as any).userId as string;
    const { hidden } = badgeVisibilitySchema.parse(req.body);
    res.json(await accountService.updateBadgeVisibility(userId, hidden));
  }),
} satisfies Record<string, RequestHandler>;

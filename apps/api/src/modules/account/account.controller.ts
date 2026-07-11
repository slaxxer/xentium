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

export const accountController = {
  uploadAvatar: (async (req, res) => {
    const userId = req.userId!;
    const file = req.file!;
    const ext = file.detectedExt ?? "jpg";
    const url = await accountService.uploadAvatar(userId, file.buffer, ext);
    res.json({ url });
  }),

  updateProfile: (async (req, res) => {
    const userId = req.userId!;
    const data = updateProfileSchema.parse(req.body);
    const updated = await accountService.updateProfile(userId, data);
    res.json(updated);
  }),

  changeUsername: (async (req, res) => {
    const userId = req.userId!;
    const { username } = changeUsernameSchema.parse(req.body);
    const result = await accountService.changeUsername(userId, username);
    res.json(result);
  }),

  requestEmailChange: (async (req, res) => {
    const userId = req.userId!;
    const { currentPassword, newEmail } = changeEmailSchema.parse(req.body);
    const result = await accountService.requestEmailChange(userId, currentPassword, newEmail);
    res.json(result);
  }),

  verifyEmailCode: (async (req, res) => {
    const userId = req.userId!;
    const { code } = verifyEmailCodeSchema.parse(req.body);
    const result = await accountService.verifyEmailCode(userId, code);
    res.json(result);
  }),

  changePassword: (async (req, res) => {
    const userId = req.userId!;
    const sessionId = req.sessionId;
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    await accountService.changePassword(userId, currentPassword, newPassword, sessionId);
    res.status(204).send();
  }),

  getSessions: (async (req, res) => {
    const userId = req.userId!;
    const sessions = await accountService.getSessions(userId);
    res.json(sessions);
  }),

  revokeSession: (async (req, res) => {
    const userId = req.userId!;
    const { sessionId } = revokeSessionSchema.parse(req.params);
    await accountService.revokeSession(userId, sessionId);
    res.status(204).send();
  }),

  getPrivacy: (async (req, res) => {
    const userId = req.userId!;
    const settings = await accountService.getPrivacySettings(userId);
    res.json(settings);
  }),

  updatePrivacy: (async (req, res) => {
    const userId = req.userId!;
    const data = privacySettingsSchema.parse(req.body);
    const updated = await accountService.updatePrivacySettings(userId, data as any);
    res.json(updated);
  }),

  getUsernameHistory: (async (req, res) => {
    const userId = req.userId!;
    const history = await accountService.getUsernameHistory(userId);
    res.json(history);
  }),

  getProfileFieldValues: (async (req, res) => {
    const userId = req.userId!;
    const fields = await accountService.getProfileFieldValues(userId);
    res.json(fields);
  }),

  updateProfileFieldValues: (async (req, res) => {
    const userId = req.userId!;
    const { values } = profileFieldValuesSchema.parse(req.body);
    const result = await accountService.updateProfileFieldValues(userId, values);
    res.json(result);
  }),

  setPin: (async (req, res) => {
    const userId = req.userId!;
    const { currentPassword, pin } = setPinSchema.parse(req.body);
    await accountService.setLoginPin(userId, currentPassword, pin);
    res.status(204).send();
  }),

  disablePin: (async (req, res) => {
    const userId = req.userId!;
    const { currentPassword } = disablePinSchema.parse(req.body);
    await accountService.disableLoginPin(userId, currentPassword);
    res.status(204).send();
  }),
  getNotificationPreferences: (async (req, res) => {
    const userId = req.userId!;
    res.json(await accountService.getNotificationPreferences(userId));
  }),

  updateNotificationPreferences: (async (req, res) => {
    const userId = req.userId!;
    const prefs  = notificationPreferencesSchema.parse(req.body);
    res.json(await accountService.updateNotificationPreferences(userId, prefs as any));
  }),

  getBadgeVisibility: (async (req, res) => {
    const userId = req.userId!;
    res.json(await accountService.getBadgeVisibility(userId));
  }),

  updateBadgeVisibility: (async (req, res) => {
    const userId = req.userId!;
    const { hidden } = badgeVisibilitySchema.parse(req.body);
    res.json(await accountService.updateBadgeVisibility(userId, hidden));
  }),
} satisfies Record<string, RequestHandler>;

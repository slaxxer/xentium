import type { RequestHandler } from "express";
import { emailAdminService } from "./email.service.js";
import {
  templateKeyParamSchema,
  saveTemplateSchema,
  testSendSchema,
  emailDesignSchema,
} from "./email.validation.js";
import { recipientLocale, requestLocaleHint } from "../../shared/i18n/serverText.js";

export const emailController = {
  listTemplates: (async (_req, res) => {
    res.json(await emailAdminService.listTemplates());
  }) as RequestHandler,

  getTemplate: (async (req, res) => {
    const { key } = templateKeyParamSchema.parse(req.params);
    res.json(await emailAdminService.getTemplate(key));
  }) as RequestHandler,

  saveTemplate: (async (req, res) => {
    const { key } = templateKeyParamSchema.parse(req.params);
    const { subject, body } = saveTemplateSchema.parse(req.body);
    res.json(await emailAdminService.saveTemplate(key, subject, body));
  }) as RequestHandler,

  resetTemplate: (async (req, res) => {
    const { key } = templateKeyParamSchema.parse(req.params);
    res.json(await emailAdminService.resetTemplate(key));
  }) as RequestHandler,

  previewTemplate: (async (req, res) => {
    const { key } = templateKeyParamSchema.parse(req.params);
    res.json(await emailAdminService.preview(key, await recipientLocale({ userId: req.userId, hint: requestLocaleHint(req) })));
  }) as RequestHandler,

  sendTest: (async (req, res) => {
    const { to, key } = testSendSchema.parse(req.body);
    // In the admin's own language, as the untouched template would reach them.
    res.json(await emailAdminService.sendTest(to, key, await recipientLocale({ userId: req.userId, hint: requestLocaleHint(req) })));
  }) as RequestHandler,

  getDesign: (async (_req, res) => {
    res.json(await emailAdminService.getDesign());
  }) as RequestHandler,

  saveDesign: (async (req, res) => {
    res.json(await emailAdminService.saveDesign(emailDesignSchema.parse(req.body)));
  }) as RequestHandler,

  previewDesign: (async (req, res) => {
    const design = emailDesignSchema.parse(req.body);
    res.json(await emailAdminService.previewDesign(design, await recipientLocale({ userId: req.userId, hint: requestLocaleHint(req) })));
  }) as RequestHandler,

  smtpStatus: (async (_req, res) => {
    res.json(await emailAdminService.smtpStatus());
  }) as RequestHandler,
};

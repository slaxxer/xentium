import type { RequestHandler } from "express";
import { emailAdminService } from "./email.service.js";
import {
  templateKeyParamSchema,
  saveTemplateSchema,
  testSendSchema,
} from "./email.validation.js";

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
    res.json(await emailAdminService.preview(key));
  }) as RequestHandler,

  sendTest: (async (req, res) => {
    const { to, key } = testSendSchema.parse(req.body);
    res.json(await emailAdminService.sendTest(to, key));
  }) as RequestHandler,

  smtpStatus: (async (_req, res) => {
    res.json(await emailAdminService.smtpStatus());
  }) as RequestHandler,
};

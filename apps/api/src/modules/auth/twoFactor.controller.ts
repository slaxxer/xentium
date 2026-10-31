import type { RequestHandler } from "express";
import { z } from "zod";
import { twoFactorCodeSchema } from "./auth.validation.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { XEC } from "../../shared/errors/xec.js";
import { adminReset, beginSetup, disable, enable, regenerateRecoveryCodes, twoFactorState } from "./twoFactor.service.js";

/** A member's own two-factor sign-in (Account → Security), plus the admin reset (ACP → Users). */

const codeBody = z.object({ code: twoFactorCodeSchema });
const requestOf = (req: Parameters<RequestHandler>[0]) => ({ ip: req.ip, userAgent: req.get("user-agent") });

export const twoFactorController = {
  state: (async (req, res) => {
    res.json(await twoFactorState(req.userId!));
  }),

  setup: (async (req, res) => {
    res.json(await beginSetup(req.userId!));
  }),

  enable: (async (req, res) => {
    const { code } = codeBody.parse(req.body);
    res.json(await enable(req.userId!, req.sessionId!, code, requestOf(req)));
  }),

  disable: (async (req, res) => {
    const { code } = codeBody.parse(req.body);
    await disable(req.userId!, code, requestOf(req));
    res.status(204).send();
  }),

  recoveryCodes: (async (req, res) => {
    const { code } = codeBody.parse(req.body);
    res.json(await regenerateRecoveryCodes(req.userId!, code, requestOf(req)));
  }),

  /** For someone who lost their phone AND their recovery codes. Not for yourself: your own page does that. */
  adminReset: (async (req, res) => {
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    if (id === req.userId) {
      throw new XentiumError({
        code: XEC.AUTH_2FA_STATE, httpStatus: 409,
        message: "Turn your own two-factor sign-in off from your account settings.",
      });
    }
    await adminReset(id, requestOf(req));
    res.status(204).send();
  }),
} satisfies Record<string, RequestHandler>;

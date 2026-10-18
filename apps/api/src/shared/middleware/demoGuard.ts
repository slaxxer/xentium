import type { RequestHandler } from "express";
import { XEC } from "@xentium/contracts";
import { env } from "../../config/env.js";
import { prisma } from "../../infrastructure/db.js";

/**
 * Demo mode (`DEMO_MODE=true`): a public install where anyone may sign in with a
 * shared admin account and look around, and a nightly job restores the data.
 *
 * Everything an admin does to CONTENT is allowed: the reset undoes it. What is
 * refused is what the reset cannot undo or what reaches outside the box:
 *
 *  - running code on the server: plugin upload, install, update, uninstall, and
 *    enabling or disabling (a disabled forum breaks the demo for everyone until
 *    the reset);
 *  - the marketplace and the licence (they bind the install to an account);
 *  - sending mail: SMTP settings, test mail, templates, invites;
 *  - taking the shared account away from the next visitor: its password, email,
 *    username, PIN, passkeys, linked sign-ins, sessions, password resets, and the
 *    administrator group's permissions;
 *  - shutting others out: maintenance mode, sign-in and registration settings,
 *    the site address and OAuth providers.
 *
 * ⚠ Matched on method + path BEFORE the routers, so a route added later is open
 * by default. When you add an endpoint in one of the families above, add it here
 * too (the test lists what must stay refused).
 */
type Rule = { methods: string[]; path: RegExp };

const WRITE = ["POST", "PUT", "PATCH", "DELETE"];

const RULES: Rule[] = [
  // ── The shared account itself ────────────────────────────────────────────
  { methods: WRITE, path: /^\/api\/account\/(password|email|email\/verify-code|pin|username)$/ },
  { methods: ["DELETE"], path: /^\/api\/account\/sessions(\/.*)?$/ },
  { methods: ["POST"], path: /^\/api\/auth\/password-reset(\/confirm)?$/ },
  { methods: WRITE, path: /^\/api\/auth\/passkey\/register\// },
  { methods: WRITE, path: /^\/api\/auth\/passkeys\// },
  { methods: WRITE, path: /^\/api\/auth\/oauth\/[^/]+\/link$/ },
  { methods: ["DELETE"], path: /^\/api\/auth\/oauth\/[^/]+$/ },
  { methods: ["POST"], path: /^\/api\/admin\/users\/[^/]+\/password-reset$/ },

  // ── Code on the server ──────────────────────────────────────────────────
  { methods: WRITE, path: /^\/api\/plugins(\/.*)?$/ },
  { methods: WRITE, path: /^\/api\/admin\/(marketplace|license)(\/.*)?$/ },

  // ── Mail out ────────────────────────────────────────────────────────────
  { methods: WRITE, path: /^\/api\/admin\/email(\/.*)?$/ },
  { methods: WRITE, path: /^\/api\/admin\/invites(\/.*)?$/ },
  { methods: WRITE, path: /^\/api\/admin\/auth-providers(\/.*)?$/ },
  { methods: WRITE, path: /^\/api\/admin\/jobs\/[^/]+$/ },
];

/** Setting keys a demo admin may not change (prefix match). */
const LOCKED_SETTINGS = ["smtp.", "maintenance.", "auth.", "site.url", "plugins.", "marketplace.", "registration."];

function refuse(res: Parameters<RequestHandler>[1]) {
  res.status(403).json({
    error: {
      code:    XEC.API_DEMO_LOCKED,
      message: "This is disabled in the demo.",
    },
  });
}

export const demoGuard: RequestHandler = async (req, res, next) => {
  if (!env.DEMO_MODE || !req.path.startsWith("/api/")) return next();
  try {
    const method = req.method.toUpperCase();
    if (RULES.some((r) => r.methods.includes(method) && r.path.test(req.path))) return refuse(res);

    // Settings: one key per request.
    const setting = /^\/api\/admin\/settings\/(.+)$/.exec(req.path);
    if (setting && WRITE.includes(method)) {
      const key = decodeURIComponent(setting[1]!);
      if (LOCKED_SETTINGS.some((p) => key === p || key.startsWith(p))) return refuse(res);
    }

    // The administrator group's permissions: taking admin.access away locks everyone out.
    const perms = /^\/api\/admin\/groups\/([^/]+)(\/permissions)?$/.exec(req.path);
    if (perms && WRITE.includes(method)) {
      const group = await prisma.group.findUnique({ where: { id: perms[1]! }, select: { key: true } });
      if (group?.key === "admin") return refuse(res);
    }
    next();
  } catch (e) { next(e); }
};

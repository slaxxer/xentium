import type { RequestHandler } from "express";
import { TtlCache, memoTtl } from "@xentium/server-kit";
import { XEC, type LegalDocumentKey } from "@xentium/contracts";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { verifyAccess } from "../auth/auth.tokens.js";
import { legalService } from "./legal.service.js";

/**
 * A signed-in member who still has to accept a legal document can do nothing else
 * through the API until they have. The site sends them to the document
 * (LegalConsentGate); this is the same rule on the server, so a script holding
 * their token can't carry on either.
 *
 * Mounted on /api after the maintenance and demo guards. Requests without a Bearer
 * token pass (guests, and the cookie-only refresh), as do the routes the document's
 * page itself needs: auth (me, accept, sign out), the legal pages, and the READ-only
 * public chrome a page renders with (site, navigation, theme, layouts…). The rest
 * answers 403 XEC-AUTH-2012 with what is pending.
 */
const OPEN = ["/auth", "/legal"];
const OPEN_FOR_READING = [
  "/site", "/nav-items", "/appearance", "/layouts", "/themes", "/emojis", "/maintenance",
  "/install", "/online", "/user-badges", "/members/groups",
];

const under = (path: string, prefixes: string[]) => prefixes.some((p) => path === p || path.startsWith(`${p}/`));

/** Is any document required at all? The common answer is no, and then nothing else is read. */
const anyRequired = memoTtl(() => legalService.consentRequired(), 30_000);
/** Each member's pending documents, briefly: this runs on every signed-in request. */
const pendingCache = new TtlCache<string, LegalDocumentKey[]>(30_000);

/** Forget what was worked out: a document, its switch or a round changed, or a member accepted. */
export function bustLegalGate(userId?: string): void {
  if (userId) pendingCache.delete(userId);
  else { anyRequired.bust(); pendingCache.clear(); }
}

export const legalGate: RequestHandler = async (req, _res, next) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return next();
  if (under(req.path, OPEN)) return next();
  if (req.method === "GET" && under(req.path, OPEN_FOR_READING)) return next();

  let userId: string;
  try {
    ({ userId } = await verifyAccess(auth.slice(7)));
  } catch {
    return next(); // a bad token is the route guard's to refuse
  }
  if (!(await anyRequired())) return next();

  let pending = pendingCache.get(userId);
  if (!pending) {
    pending = await legalService.pendingFor(userId);
    pendingCache.set(userId, pending);
  }
  if (pending.length === 0) return next();
  throw new XentiumError({
    code: XEC.AUTH_LEGAL_PENDING, httpStatus: 403,
    message: "Accept the site's legal documents to continue",
    details: { pending },
  });
};

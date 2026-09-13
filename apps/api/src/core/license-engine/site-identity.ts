// Who this install is, from the marketplace's point of view: its UUID, the host
// it claims publicly, and which environment it runs in.
//
// Extracted from license-engine so the protocol client can ask these questions
// without importing the engine that imports the client. Everything here is
// dependency-light on purpose — prisma, settings, env, nothing else.

import type { DeployEnvironment } from "@nodevo/contracts";
import { prisma } from "../../infrastructure/db.js";
import { env, isProd } from "../../config/env.js";
import { getSetting } from "../../shared/utils/settings.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { NEC } from "../../shared/errors/nec.js";

/**
 * The host this instance reports. The admin-configured canonical URL
 * (`site.url`, the same one served in canonical/OG meta) is the source of
 * truth — APP_URL is only the pre-install / unset fallback.
 *
 * Since v2 this is REPORTED METADATA, not a key: a licence binds to the
 * install's siteId, and the marketplace records hostnames only so an operator
 * can recognise a site. A rebrand or a staging promotion is no longer a support
 * ticket.
 */
export async function getSiteDomain(): Promise<string> {
  const canonical = await getSetting<string>("site.url", "");
  try {
    return new URL(canonical || env.APP_URL).host;
  } catch {
    return "localhost";
  }
}

function isLocalHost(host: string): boolean {
  const h = host.split(":")[0] ?? host;
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h.endsWith(".local") ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

/**
 * Where this instance runs. Only `production` consumes a licence seat on the
 * marketplace — staging and development are uncapped, which is what keeps local
 * work, CI and previews painless.
 */
export async function resolveEnvironment(): Promise<DeployEnvironment> {
  if (!isProd) return "development";
  return isLocalHost(await getSiteDomain()) ? "staging" : "production";
}

/**
 * This install's UUID, minted by the installer's finalize step into
 * ncf_installs.siteId. The single source for anything talking to the
 * marketplace.
 *
 * THROWS when there is no install row. It used to fall back to the literal
 * string "dev-site", and that fallback is a SHARED IDENTITY: activations, seat
 * counts and audit trails from every affected install collapse into one bucket.
 * Now that entitlements bind to the siteId rather than the hostname it would
 * stop being a collision and become a licence bypass, so an instance with no
 * identity must not be able to talk to the marketplace at all.
 *
 * Callers that must not be blocked by this (disconnect, which has to work even
 * when everything else is broken) catch it deliberately.
 */
export async function getSiteId(): Promise<string> {
  const row = await prisma.install.findFirst({ select: { siteId: true } });
  if (!row?.siteId) {
    throw new XentiumError({
      code:       NEC.LICENSE_SITE_ID_MISSING,
      httpStatus: 503,
      message:    "This instance has no install identity yet. Finish the installer before connecting a marketplace account.",
    });
  }
  return row.siteId;
}

import type { RequestHandler } from "express";
import { XEC } from "@xentium/contracts";

/**
 * Refuse request bodies sent compressed (`Content-Encoding: br | gzip | deflate`).
 *
 * Express's body parser decompresses such bodies by default, which put Node's own
 * decoders in front of anyone on the internet without signing in. The Brotli one had
 * a remote-code-execution bug (CVE-2026-111497, "Node2Shell", fixed in Node 22.23.4 /
 * 24.22.1 / 26.12.1), so a site on an older Node could be taken over by one request.
 *
 * Nothing legitimate needs it: browsers never compress what they send, and neither
 * does our CLI. So the API answers 415 before ANY parser runs — core's and the ones a
 * plugin router brings — and the decompressor is never reached, whatever Node it is.
 * The parsers also run with `inflate: false`, so a header-less trick changes nothing.
 */
export const rejectEncodedBodies: RequestHandler = (req, res, next) => {
  const encoding = String(req.headers["content-encoding"] ?? "").trim().toLowerCase();
  if (!encoding || encoding === "identity") return next();
  res.status(415).json({
    error: { code: XEC.API_ENCODED_BODY, message: "Compressed request bodies are not accepted" },
  });
};

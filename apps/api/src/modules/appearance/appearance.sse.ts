// Live theme sync — push transport (SSE + Redis pub/sub).
//
// Replaces the old per-client poll of /api/appearance/version. Each client holds
// one Server-Sent Events connection to /api/appearance/stream; the server pushes a
// `version` event only when the active theme actually changes (admin saved a style,
// activated a pack, restored a snapshot). Steady state is zero requests per client.
//
// Cross-process fan-out: Nodevo runs multiple processes/instances (server + worker,
// and potentially several server replicas behind a load balancer). A theme save
// happens on whichever server handled the request, but SSE clients may be connected
// to a *different* instance. So the save PUBLISHes the new version to a Redis channel
// and every instance SUBSCRIBEs once — each then fans the event out to the clients it
// holds locally.

import type { Response } from "express";
import { Redis } from "ioredis";
import { env } from "../../config/env.js";
import { rkey, redis } from "../../infrastructure/redis.js";

const CHANNEL = rkey("appearance", "version");

// This process's share of connected clients.
const clients = new Set<Response>();
let subscriber: Redis | null = null;

/** Write a style-version event to every locally-connected client. */
function broadcast(version: number): void {
  const frame = `event: version\ndata: ${version}\n\n`;
  for (const res of clients) {
    try { res.write(frame); } catch { /* a dead socket is cleaned up by its close handler */ }
  }
}

/**
 * Subscribe to the cross-process appearance channel once per process. Safe to call
 * multiple times — only the first call wires the subscriber. Call at server boot.
 */
export function initAppearanceSse(): void {
  if (subscriber) return;
  subscriber = new Redis(env.REDIS_URL);
  subscriber.on("error", (err) => console.error(`[redis:appearance-sse] ${err.message}`));
  subscriber.on("message", (channel, message) => {
    if (channel !== CHANNEL) return;
    const v = Number(message);
    if (Number.isFinite(v)) broadcast(v);
  });
  subscriber.subscribe(CHANNEL).catch((err) =>
    console.error(`[appearance-sse] subscribe failed: ${err.message}`),
  );
}

/** Publish a new style version to all processes. Called right after the DB bump. */
export async function publishStyleVersion(version: number): Promise<void> {
  try { await redis.publish(CHANNEL, String(version)); }
  catch (err) { console.error(`[appearance-sse] publish failed: ${(err as Error).message}`); }
}

/**
 * Attach a freshly-opened SSE response and stream events until the client closes.
 * `currentVersion` is sent immediately as the baseline: the client records it and
 * only refetches CSS on a *later* version. On EventSource auto-reconnect the client
 * keeps its last-seen version, so a baseline that differs (a change missed while
 * disconnected) still triggers a refetch.
 */
export function addSseClient(res: Response, currentVersion: number): void {
  clients.add(res);
  res.write(`retry: 3000\n`);                                   // EventSource reconnect backoff
  res.write(`event: version\ndata: ${currentVersion}\n\n`);     // baseline

  // Heartbeat — keeps the connection alive through proxy/idle timeouts.
  const ping = setInterval(() => {
    try { res.write(`: ping\n\n`); } catch { /* close handler cleans up */ }
  }, 25_000);

  const cleanup = () => {
    clearInterval(ping);
    clients.delete(res);
  };
  res.on("close", cleanup);
  res.on("error", cleanup);
}

/** Graceful shutdown — end every open stream and close the subscriber connection. */
export async function closeAppearanceSse(): Promise<void> {
  for (const res of clients) { try { res.end(); } catch { /* ignore */ } }
  clients.clear();
  if (subscriber) { await subscriber.quit().catch(() => {}); subscriber = null; }
}

/** Test/inspection helper. */
export function sseClientCount(): number {
  return clients.size;
}

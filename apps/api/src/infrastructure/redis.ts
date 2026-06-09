import { Redis } from 'ioredis';
import { env } from '../config/env.js';

// General-purpose client (cache, rate limiting).
export const redis = new Redis(env.REDIS_URL);

// BullMQ REQUIRES maxRetriesPerRequest: null on its connection.
export const bullConnection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

// Error listener
for (const [name, client] of [['cache', redis], ['bull', bullConnection]] as const) {
  client.on('error', (err) => console.error(`[redis:${name}] ${err.message}`));
}

// Namespacing helper — use everywhere instead of raw keys.
export const rkey = (...parts: string[]) => `${env.REDIS_KEY_PREFIX}${parts.join(':')}`;

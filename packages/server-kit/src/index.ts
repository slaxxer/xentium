/**
 * @xentium/server-kit — the server-side utilities every Xentium-framework
 * application needs, and none of the domain it serves (ADR-0006).
 *
 * Everything with a dependency is a factory: an application injects its own
 * store, secret, Redis client or filesystem root. Nothing here reaches for a
 * module singleton, which is also why all of it is testable without a database.
 */
export { memoTtl, TtlCache } from "./memoTtl.js";
export { paginate } from "./paginate.js";

export { createSettings } from "./settings.js";
export type { Settings, SettingsStore, SettingsOptions } from "./settings.js";

export { createSecretBox } from "./secretBox.js";
export type { SecretBox } from "./secretBox.js";

export { createRateLimiterFactory, byUserId, ipKeyGenerator } from "./rateLimit.js";
export type { RateLimitRedis, RateLimiterDeps, RateLimiterOptions } from "./rateLimit.js";

export { uploadSingle } from "./upload.js";
export type { UploadLimit } from "./upload.js";

export { LocalStorageProvider } from "./storage/LocalStorageProvider.js";
export type { LocalStorageOptions } from "./storage/LocalStorageProvider.js";
export type { StorageProvider } from "./storage/StorageProvider.js";

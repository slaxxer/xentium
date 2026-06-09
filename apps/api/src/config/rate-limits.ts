export const RATE_LIMITS = {
  auth:   { windowMs: 15 * 60_000, max: 10 },  // login/reset — wired in Phase 2
  api:    { windowMs: 60_000, max: 120 },
  upload: { windowMs: 60_000, max: 20 },
} as const;

export type RateLimitName = keyof typeof RATE_LIMITS;

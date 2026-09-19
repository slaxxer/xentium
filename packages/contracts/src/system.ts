// What a server needs to run Xentium, in ONE place.
//
// Read by the install wizard's environment step, the setup-mode server, the
// `npm create xentium` preflight and `xentium doctor`. They used to keep their own
// numbers, and they drifted: the wizard accepted Node 20 while the project needs
// 22.12, so a server on Node 20 passed the check and then failed to run.
//
// Pure data and pure functions, so it's safe in the browser and in a CLI that has
// nothing else of ours installed.

export interface VersionRequirement {
  /** Below this, installing is refused. */
  minimum: string;
  /** Below this (but at or above `minimum`), we warn. */
  recommended?: string;
}

export const SYSTEM_REQUIREMENTS = {
  node:     { minimum: '22.12.0', recommended: '24.0.0' },
  npm:      { minimum: '10.0.0' },
  postgres: { minimum: '14.0', recommended: '17.0' },
  redis:    { minimum: '6.0' },
  /**
   * BullMQ can lose jobs under any other eviction policy: when Redis runs out of
   * memory it evicts keys, and some of those keys are queued jobs. Anything else
   * is a warning, not a refusal, because plenty of small sites never fill Redis.
   */
  redisMaxmemoryPolicy: 'noeviction',
  /** Free space the app itself needs where it's installed. */
  installDiskBytes: 1024 * 1024 * 1024,
  /** Free space for uploads and data, checked by the wizard. */
  dataDiskBytes: 500 * 1024 * 1024,
  /** Below this we warn; builds and the worker get tight. */
  memoryBytes: 1024 * 1024 * 1024,
} as const satisfies {
  node: VersionRequirement;
  npm: VersionRequirement;
  postgres: VersionRequirement;
  redis: VersionRequirement;
  redisMaxmemoryPolicy: string;
  installDiskBytes: number;
  dataDiskBytes: number;
  memoryBytes: number;
};

/**
 * Compare two dotted versions numerically: "22.12.0" > "22.9.1".
 *
 * Tolerates a leading `v`, a missing patch ("17.0" == "17.0.0") and a prerelease
 * tail ("24.0.0-rc.1" compares as 24.0.0), which is all a version reported by
 * `node`, `npm`, `SELECT version()` or `INFO server` ever needs. Returns -1, 0 or 1.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    v.trim().replace(/^v/i, '').split(/[-+ ]/)[0]!.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** `"ok"`, `"warn"` (below recommended) or `"fail"` (below minimum). */
export function checkVersion(detected: string, req: VersionRequirement): 'ok' | 'warn' | 'fail' {
  if (compareVersions(detected, req.minimum) < 0) return 'fail';
  if (req.recommended && compareVersions(detected, req.recommended) < 0) return 'warn';
  return 'ok';
}

/** "22.12.0" → "22.12", "17.0" → "17": how we print a requirement to people. */
export function displayVersion(v: string): string {
  return v.replace(/(\.0)+$/, '');
}

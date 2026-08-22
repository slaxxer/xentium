/**
 * Base-version comparison for plugin compatibility windows.
 *
 * Prerelease and build metadata are deliberately ignored: a `1.0.0-alpha.3`
 * host must accept a plugin targeting `1.0`, or every prerelease cut would
 * reject the entire plugin ecosystem.
 */

/** "1.0.0-alpha.1" → [1, 0, 0] — prerelease/build metadata ignored. */
export function baseVersion(version: string): [number, number, number] {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(version);
  if (!m) return [0, 0, 0];
  return [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
}

/** Numeric compare of base versions: negative if a < b, 0 if equal. */
export function compareBaseVersions(a: string, b: string): number {
  const [a1, a2, a3] = baseVersion(a);
  const [b1, b2, b3] = baseVersion(b);
  return a1 - b1 || a2 - b2 || a3 - b3;
}

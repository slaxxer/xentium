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

/**
 * Prerelease-aware compare: a prerelease sorts below its release, identifiers
 * compare one by one, numbers numerically ("alpha.10" > "alpha.9").
 */
export function compareVersions(a: string, b: string): number {
  const base = compareBaseVersions(a, b);
  if (base !== 0) return Math.sign(base);
  const pre = (v: string) => (/^\d+(?:\.\d+){0,2}-([0-9A-Za-z.-]+)/.exec(v.split("+")[0]!)?.[1] ?? "");
  const x = pre(a);
  const y = pre(b);
  if (x === y) return 0;
  if (!x) return 1;
  if (!y) return -1;
  const xs = x.split(".");
  const ys = y.split(".");
  for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
    const p = xs[i];
    const q = ys[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const np = /^\d+$/.test(p);
    const nq = /^\d+$/.test(q);
    if (np && nq) return Number(p) > Number(q) ? 1 : -1;
    if (np) return -1;
    if (nq) return 1;
    return p > q ? 1 : -1;
  }
  return 0;
}

const hasPrerelease = (v: string) => /^\d+(?:\.\d+){0,2}-/.test(v);

/**
 * Does `host` satisfy a declared minimum?
 *
 * Written WITHOUT a prerelease ("1.0", "1.0.0"), a requirement names a release
 * LINE and every prerelease of it qualifies — the rule since the start, so a
 * `1.0.0-alpha.3` host accepts a plugin targeting 1.0. Written WITH one
 * ("1.0.0-alpha.11"), it is exact: a plugin that needs something only alpha.11
 * shipped can finally say so, and alpha.10 refuses it instead of installing a
 * plugin that does nothing.
 */
export function meetsMinimum(host: string, min: string): boolean {
  return hasPrerelease(min) ? compareVersions(host, min) >= 0 : compareBaseVersions(host, min) >= 0;
}

/** Does `host` stay within a declared maximum? Same two readings as the minimum. */
export function withinMaximum(host: string, max: string): boolean {
  return hasPrerelease(max) ? compareVersions(host, max) <= 0 : compareBaseVersions(host, max) <= 0;
}

/** In-process TTL memoization for cheap-to-store, expensive-to-compute reads
 *  (footer stats, built CSS, settings). One shape for every ad-hoc
 *  `let cache; if (Date.now() - at < TTL)` pattern.
 *
 *  Concurrent callers during a miss share the same in-flight promise; a
 *  rejected computation is not cached, so the next call retries. */
export function memoTtl<T>(fn: () => Promise<T>, ttlMs: number): (() => Promise<T>) & { bust: () => void } {
  let value: { at: number; data: T } | null = null;
  let inflight: Promise<T> | null = null;

  const memoized = async (): Promise<T> => {
    if (value && Date.now() - value.at < ttlMs) return value.data;
    if (inflight) return inflight;
    inflight = fn()
      .then((data) => {
        value = { at: Date.now(), data };
        return data;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };

  memoized.bust = () => {
    value = null;
  };
  return memoized;
}

/** Keyed variant for caches with a small, bounded key space (e.g. settings by
 *  key, CSS by version). Not an LRU — do not use with unbounded user input. */
export class TtlCache<K, V> {
  private map = new Map<K, { at: number; data: V }>();
  constructor(private ttlMs: number) {}

  get(key: K): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at >= this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    return hit.data;
  }

  set(key: K, data: V): void {
    this.map.set(key, { at: Date.now(), data });
  }

  delete(key: K): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}

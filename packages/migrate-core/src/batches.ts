/**
 * Large boards in pages.
 *
 * A forum with millions of posts can't be read into memory in one go: the bodies
 * alone run to gigabytes. So the heavy lists (posts, private messages, likes) may be
 * a `Batched` source instead of an array: it knows its size up front, for the
 * progress bars, and hands over one page at a time while the loader works through it.
 * Only the page being loaded is held in memory.
 */
export interface Batched<T> {
  /** How many rows the source has. Some may still be skipped while paging (deleted posts and so on). */
  readonly total: number;
  batches(): AsyncIterable<T[]>;
}

/** A list the loader accepts: everything at once (small sources, tests) or in pages. */
export type Rows<T> = T[] | Batched<T>;

/** Rows per page. Big enough that the round trips don't matter, small enough to stay a few MB. */
export const BATCH_SIZE = Number(process.env.XENTIUM_MIGRATE_BATCH) || 2000;

export function isBatched<T>(rows: Rows<T> | undefined): rows is Batched<T> {
  return !!rows && !Array.isArray(rows);
}

export function sizeOf<T>(rows: Rows<T> | undefined): number {
  if (!rows) return 0;
  return Array.isArray(rows) ? rows.length : rows.total;
}

/** Every page of a list; an array comes in pages too, so the loader has one path. */
export async function* pagesOf<T>(rows: Rows<T> | undefined, size = BATCH_SIZE): AsyncIterable<T[]> {
  if (!rows) return;
  if (Array.isArray(rows)) {
    for (let i = 0; i < rows.length; i += size) yield rows.slice(i, i + size);
    return;
  }
  for await (const page of rows.batches()) if (page.length) yield page;
}

/**
 * Keyset paging over a numeric id: `WHERE id > :after ORDER BY id LIMIT :limit`, which
 * stays fast at any depth where OFFSET would not. Opens its own connection when the
 * loader starts on it (the extract's connection is closed by then) and closes it after.
 * `map` turns a page of raw rows into imported ones, and may drop some (it reports why).
 */
export function keyset<C, R, T>(options: {
  total: number;
  connect: () => Promise<C>;
  close: (conn: C) => Promise<void>;
  fetch: (conn: C, after: number, limit: number) => Promise<R[]>;
  key: (row: R) => number;
  map: (rows: R[], conn: C) => T[] | Promise<T[]>;
  size?: number;
}): Batched<T> {
  const size = options.size ?? BATCH_SIZE;
  return {
    total: options.total,
    async *batches() {
      const conn = await options.connect();
      try {
        let after = -1;
        for (;;) {
          const rows = await options.fetch(conn, after, size);
          if (!rows.length) return;
          after = options.key(rows[rows.length - 1]!);
          yield await options.map(rows, conn);
          if (rows.length < size) return;
        }
      } finally {
        await options.close(conn);
      }
    },
  };
}

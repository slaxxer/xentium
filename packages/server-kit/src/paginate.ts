import { buildPaginationMeta, type PaginatedResponse } from "@xentium/contracts";

/** The standard list-endpoint query: fetch one page + total count in parallel,
 *  meta via buildPaginationMeta (the ONLY producer of pagination meta). The
 *  page query is a thunk so call sites keep full Prisma arg/result typing:
 *
 *    return paginate(page, limit,
 *      (skip, take) => prisma.errorLog.findMany({ where, orderBy, skip, take }),
 *      () => prisma.errorLog.count({ where }),
 *    );
 *
 *  Callers map/shape `data` afterwards as needed. */
export async function paginate<Row>(
  page: number,
  limit: number,
  fetchPage: (skip: number, take: number) => Promise<Row[]>,
  count: () => Promise<number>,
): Promise<PaginatedResponse<Row>> {
  const [data, total] = await Promise.all([fetchPage((page - 1) * limit, limit), count()]);
  return { data, meta: buildPaginationMeta({ page, limit, total }) };
}

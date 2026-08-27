/**
 * PostgREST enforces a server-side row cap (1000 by default) that silently overrides any
 * higher .limit() a query asks for. A truncated result looks exactly like a complete one,
 * which for cutoff data means confidently answering from half the evidence.
 *
 * Treat a response that exactly fills the cap as suspect and page through the rest.
 */
export const POSTGREST_MAX_ROWS = 1000;

type RangeQuery<Row> = {
  range: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;
};

export async function fetchAllRows<Row>(
  buildQuery: () => RangeQuery<Row>,
  pageSize = POSTGREST_MAX_ROWS,
): Promise<Row[]> {
  const rows: Row[] = [];

  for (let page = 0; ; page += 1) {
    const from = page * pageSize;
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;

    rows.push(...data);
    if (data.length < pageSize) break;
  }

  return rows;
}

// Pure builder for the Activity query so filtering/search logic is unit-tested without a database.
export type TxnFilter = {
  q?: string;
  direction?: 'debit' | 'credit';
  categoryIds?: number[]; // may include 0 = uncategorised
  accountIds?: number[];
  from?: number; // epoch ms, inclusive
  to?: number; // epoch ms, exclusive
  minPaise?: number;
  maxPaise?: number;
  tag?: string;
  transfers?: 'hide' | 'show' | 'only';
};

export const EMPTY_FILTER: TxnFilter = { transfers: 'show' };

export function buildTxnQuery(f: TxnFilter, status: 'confirmed' | 'pending' = 'confirmed') {
  const where: string[] = ['t.status = ?'];
  const params: (string | number)[] = [status];
  const q = f.q?.trim();
  if (q) {
    // escape LIKE wildcards so "50%" searches literally
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push("(t.merchant LIKE ? ESCAPE '\\' OR t.notes LIKE ? ESCAPE '\\' OR (',' || t.tags || ',') LIKE ? ESCAPE '\\')");
    params.push(like, like, like);
    // an amount typed as a number also matches by value: "450" or "450.50"
    const n = Number(q.replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0) {
      where[where.length - 1] = where[where.length - 1].replace(/\)$/, ' OR t.amount_paise = ?)');
      params.push(Math.round(n * 100));
    }
  }
  if (f.direction) { where.push('t.direction = ?'); params.push(f.direction); }
  if (f.categoryIds?.length) {
    const ids = f.categoryIds.filter((i) => i > 0);
    const parts: string[] = [];
    if (ids.length) { parts.push(`t.category_id IN (${ids.map(() => '?').join(',')})`); params.push(...ids); }
    if (f.categoryIds.includes(0)) parts.push('t.category_id IS NULL');
    where.push(`(${parts.join(' OR ')})`);
  }
  if (f.accountIds?.length) { where.push(`t.account_id IN (${f.accountIds.map(() => '?').join(',')})`); params.push(...f.accountIds); }
  if (f.from != null) { where.push('t.ts >= ?'); params.push(f.from); }
  if (f.to != null) { where.push('t.ts < ?'); params.push(f.to); }
  if (f.minPaise != null) { where.push('t.amount_paise >= ?'); params.push(f.minPaise); }
  if (f.maxPaise != null) { where.push('t.amount_paise <= ?'); params.push(f.maxPaise); }
  if (f.tag) { where.push("(',' || t.tags || ',') LIKE ?"); params.push(`%,${f.tag},%`); }
  if (f.transfers === 'hide') where.push('t.is_transfer = 0');
  if (f.transfers === 'only') where.push('t.is_transfer = 1');
  return { where: where.join(' AND '), params };
}

/** How many filters (beyond search text) are active; drives the badge on the filter button. */
export function activeFilterCount(f: TxnFilter): number {
  return [
    f.direction, f.categoryIds?.length, f.accountIds?.length, f.from != null || f.to != null,
    f.minPaise != null || f.maxPaise != null, f.tag, f.transfers && f.transfers !== 'show',
  ].filter(Boolean).length;
}


/** Query-string parameters accepted by the Activity screen when another screen drills down into it. */
export type ActivityParams = { account?: string; q?: string; transfers?: string; category?: string; month?: string; direction?: string };

/** Turns drill-down parameters into a filter (and search text). A month is "YYYY-MM"; category "none" means uncategorised. Bad values are ignored. */
export function filterFromParams(p: ActivityParams): { filter: TxnFilter; search: string } {
  const filter: TxnFilter = { ...EMPTY_FILTER };
  if (p.account && Number.isInteger(Number(p.account))) filter.accountIds = [Number(p.account)];
  if (p.transfers === 'only' || p.transfers === 'hide') filter.transfers = p.transfers;
  if (p.category === 'none') filter.categoryIds = [0];
  else if (p.category && /^\d+$/.test(p.category)) filter.categoryIds = [Number(p.category)];
  if (p.direction === 'debit' || p.direction === 'credit') filter.direction = p.direction;
  const m = p.month?.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (m) {
    filter.from = new Date(Number(m[1]), Number(m[2]) - 1, 1).getTime();
    filter.to = new Date(Number(m[1]), Number(m[2]), 1).getTime();
  }
  const search = p.q?.trim() ?? '';
  if (search) filter.q = search;
  return { filter, search };
}

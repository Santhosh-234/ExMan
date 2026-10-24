import { createHash } from 'node:crypto';

const DAY = 86_400_000;

/** Formats people chose to share (their regex shapes only: no message text, amounts or names), grouped, most-shared first. */
export function sharedCandidates(db, days = 90, now = Date.now()) {
  const rows = db.prepare("SELECT install_id, received_at, props FROM events WHERE name = 'pattern_share' AND received_at >= ? ORDER BY received_at").all(now - days * DAY);
  const by = new Map();
  for (const r of rows) {
    const p = JSON.parse(r.props);
    const key = JSON.stringify([p.sender_key, p.direction, p.rx_value, p.rx_payee, p.rx_acct, p.currency]);
    const e = by.get(key) ?? { sender_key: p.sender_key, direction: p.direction, amount_re: p.rx_value, merchant_re: p.rx_payee || null, account_re: p.rx_acct || null, currency: p.currency, installs: new Set(), n: 0, last: 0 };
    e.n++; e.installs.add(r.install_id); e.last = Math.max(e.last, r.received_at);
    by.set(key, e);
  }
  return [...by.entries()]
    .map(([key, e]) => ({ ...e, installs: e.installs.size, id: `${e.sender_key}-${createHash('sha1').update(key).digest('hex').slice(0, 8)}` }))
    .sort((a, b) => b.installs - a.installs || b.n - a.n || a.id.localeCompare(b.id));
}

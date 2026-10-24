import { DatabaseSync } from 'node:sqlite';

export const EVENT_DAYS = 90; // raw events
export const AGG_DAYS = 366; // daily aggregates (12 months)
const DAY = 86_400_000;
export const MS_BUCKETS = [100, 250, 500, 1000, 2500, 5000];

export const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

/** Aggregation keys for one event: a count, sums of numeric fields, and a time histogram for `ms`. Free text (gap_report) is never aggregated. */
export function aggregateKeys(name, props) {
  if (name === 'gap_report' || name === 'pattern_share') return [];
  const dims = [];
  const nums = [];
  for (const [k, v] of Object.entries(props)) {
    if (typeof v === 'string') dims.push(`${k}=${v}`);
    else if (k === 'os_version') dims.push(`${k}=${v}`);
    else nums.push([k, v]);
  }
  dims.sort();
  const dim = dims.join(',');
  const rows = [[dim, '#count', 1]];
  for (const [k, v] of nums) {
    if (k === 'ms') {
      const edge = MS_BUCKETS.find((b) => v <= b);
      rows.push([dim, edge ? `ms<=${edge}` : `ms>${MS_BUCKETS.at(-1)}`, 1]);
    } else rows.push([dim, `sum:${k}`, v]);
  }
  return rows;
}

export function openStore(file = ':memory:') {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, received_at INTEGER NOT NULL, install_id TEXT NOT NULL, ts INTEGER NOT NULL, name TEXT NOT NULL, props TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS events_install ON events (install_id);
    CREATE INDEX IF NOT EXISTS events_received ON events (received_at);
    CREATE TABLE IF NOT EXISTS agg (day TEXT NOT NULL, name TEXT NOT NULL, dim TEXT NOT NULL, key TEXT NOT NULL, value INTEGER NOT NULL, PRIMARY KEY (day, name, dim, key)) WITHOUT ROWID;
  `);
  const insertEvent = db.prepare('INSERT INTO events (received_at, install_id, ts, name, props) VALUES (?, ?, ?, ?, ?)');
  const bump = db.prepare('INSERT INTO agg (day, name, dim, key, value) VALUES (?, ?, ?, ?, ?) ON CONFLICT (day, name, dim, key) DO UPDATE SET value = value + excluded.value');

  return {
    db,
    /** Stores validated events and bumps the daily aggregates, all in one transaction. */
    add(installId, events, now) {
      db.exec('BEGIN');
      try {
        for (const e of events) {
          // client clocks are untrusted: the aggregate day is the server's, and a wild event time falls back to receipt time
          const ts = Number.isFinite(e.ts) && e.ts > now - EVENT_DAYS * DAY && e.ts < now + DAY ? Math.round(e.ts) : now;
          insertEvent.run(now, installId, ts, e.name, JSON.stringify(e.props));
          for (const [dim, key, value] of aggregateKeys(e.name, e.props)) bump.run(dayOf(now), e.name, dim, key, value);
        }
        db.exec('COMMIT');
      } catch (err) { db.exec('ROLLBACK'); throw err; }
    },
    /** "Forget me": removes this install's raw events. Aggregates are anonymous counts with no install id, so they stay. */
    forget(installId) {
      return Number(db.prepare('DELETE FROM events WHERE install_id = ?').run(installId).changes);
    },
    /** Retention: raw events 90 days, aggregates 12 months. */
    purge(now) {
      const e = db.prepare('DELETE FROM events WHERE received_at < ?').run(now - EVENT_DAYS * DAY).changes;
      const a = db.prepare('DELETE FROM agg WHERE day < ?').run(dayOf(now - AGG_DAYS * DAY)).changes;
      return { events: Number(e), agg: Number(a) };
    },
    close: () => db.close(),
  };
}

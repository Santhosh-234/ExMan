#!/usr/bin/env node
// Usage: node report.mjs [days=30]   (run on the VM; reads the database directly, nothing is exposed over HTTP)
import { DatabaseSync } from 'node:sqlite';
import { dayOf, MS_BUCKETS } from './store.mjs';

const days = Number(process.argv[2] ?? 30);
const db = new DatabaseSync(`${process.env.DATA_DIR ?? '.'}/collector.db`, { readOnly: true });
const since = dayOf(Date.now() - days * 86_400_000);
const rows = db.prepare('SELECT name, dim, key, SUM(value) AS v FROM agg WHERE day >= ? GROUP BY name, dim, key').all(since);
const by = (name) => rows.filter((r) => r.name === name);
const dimOf = (r, k) => r.dim.split(',').find((x) => x.startsWith(`${k}=`))?.slice(k.length + 1) ?? '';
const table = (title, list) => { console.log(`\n${title}`); if (!list.length) return console.log('  (none)'); for (const l of list) console.log(`  ${l}`); };

console.log(`ExMan telemetry, last ${days} days (since ${since})`);

const opens = by('app_open').filter((r) => r.key === '#count');
table('App opens by version / update source', opens.map((r) => `${dimOf(r, 'version')} ${dimOf(r, 'update')} runtime ${dimOf(r, 'runtime')} (android ${dimOf(r, 'os_version')}): ${r.v}`).sort());

const screens = new Map();
for (const r of by('screen_load')) {
  const s = dimOf(r, 'screen');
  const e = screens.get(s) ?? { n: 0, h: {} };
  if (r.key === '#count') e.n = r.v; else if (r.key.startsWith('ms')) e.h[r.key] = r.v;
  screens.set(s, e);
}
const pct = (h, n, p) => { let acc = 0; for (const b of MS_BUCKETS) { acc += h[`ms<=${b}`] ?? 0; if (acc >= n * p) return `<=${b}ms`; } return `>${MS_BUCKETS.at(-1)}ms`; };
table('Screen load (median / 95th percentile, bucketed)', [...screens].sort((a, b) => b[1].n - a[1].n).map(([s, e]) => `${s.padEnd(14)} n=${String(e.n).padEnd(6)} p50 ${pct(e.h, e.n, 0.5)}  p95 ${pct(e.h, e.n, 0.95)}`));

const banks = new Map();
for (const r of by('parser_stats')) { const b = dimOf(r, 'bank'); const e = banks.get(b) ?? { parsed: 0, unrecognised: 0, taught: 0 }; const k = r.key.replace('sum:', ''); if (k in e) e[k] = r.v; banks.set(b, e); }
table('Message reading by bank', [...banks].sort((a, b) => b[1].unrecognised - a[1].unrecognised).map(([b, e]) => `${b.padEnd(10)} read ${e.parsed}  missed ${e.unrecognised}  taught ${e.taught}  (${((e.unrecognised / Math.max(1, e.parsed + e.unrecognised)) * 100).toFixed(1)}% missed)`));

table('Errors', by('error').filter((r) => r.key === '#count').sort((a, b) => b.v - a.v).map((r) => `${r.v}x ${dimOf(r, 'kind')} ${dimOf(r, 'code')} on ${dimOf(r, 'screen')}`));
table('Features used', by('feature_used').filter((r) => r.key === '#count').sort((a, b) => b.v - a.v).map((r) => `${r.v}x ${dimOf(r, 'feature')}`));
table('Import timings', by('import_completed').filter((r) => r.key === '#count').map((r) => `${r.v}x  ${dimOf(r, 'messages')} messages took ${dimOf(r, 'ms')}`));

const gaps = db.prepare("SELECT json_extract(props, '$.sender_key') AS sender, json_extract(props, '$.template') AS template, COUNT(*) AS n FROM events WHERE name = 'gap_report' GROUP BY 1, 2 ORDER BY n DESC LIMIT 20").all();
table('Reported unreadable message formats (raw events, kept 90 days)', gaps.map((g) => `${g.n}x [${g.sender}] ${g.template}`));

#!/usr/bin/env node
// Usage: node report.mjs [days=30]   (run on the VM; reads the database directly, nothing is exposed over HTTP)
import { DatabaseSync } from 'node:sqlite';
import { dayOf, MS_BUCKETS } from './store.mjs';

import { sharedCandidates } from './candidates.mjs';

const cmd = ['templates', 'errors', 'slow', 'shared'].includes(process.argv[2]) ? process.argv[2] : null;
const days = Number((cmd ? process.argv[3] : process.argv[2]) ?? 30);
const db = new DatabaseSync(`${process.env.DATA_DIR ?? '.'}/collector.db`, { readOnly: true });
const since = dayOf(Date.now() - days * 86_400_000);
const sinceMs = Date.now() - days * 86_400_000;
const rows = db.prepare('SELECT name, dim, key, SUM(value) AS v FROM agg WHERE day >= ? GROUP BY name, dim, key').all(since);
const by = (name) => rows.filter((r) => r.name === name);
const dimOf = (r, k) => r.dim.split(',').find((x) => x.startsWith(`${k}=`))?.slice(k.length + 1) ?? '';
const table = (title, list) => { console.log(`\n${title}`); if (!list.length) return console.log('  (none)'); for (const l of list) console.log(`  ${l}`); };


/** The build an install was running at a given time: version, update source and runtime, from its latest app_open before that. */
const openEvents = db.prepare("SELECT install_id, received_at, props FROM events WHERE name = 'app_open' ORDER BY received_at").all().map((r) => ({ ...r, p: JSON.parse(r.props) }));
const buildAt = (install, t) => { let b = null; for (const o of openEvents) if (o.install_id === install && o.received_at <= t) b = o.p; return b ? `${b.version} ${b.update} ${b.runtime}` : 'unknown build'; };
const when = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');

if (cmd === 'templates') {
  // masked message formats people reported, with a ready-to-paste parser test (digits and words are stand-ins for the real ones)
  const sample = (t) => t.replace(/<VPA>/g, 'name@bank').replace(/<URL>/g, 'https://x.in').replace(/<W>/g, 'Sample').replace(/#,#\.#/g, '1,250.50').replace(/#\.#/g, '250.50').replace(/#,#/g, '1,250').replace(/#/g, '1234');
  const rows = db.prepare("SELECT json_extract(props, '$.sender_key') AS sender, json_extract(props, '$.template') AS template, COUNT(*) AS n, COUNT(DISTINCT install_id) AS installs, MIN(received_at) AS first, MAX(received_at) AS last FROM events WHERE name = 'gap_report' AND received_at >= ? GROUP BY 1, 2 ORDER BY installs DESC, n DESC").all(sinceMs);
  console.log(`Unreadable formats reported in the last ${days} days: ${rows.length}\n`);
  for (const r of rows) {
    console.log(`${r.n}x from ${r.installs} install(s), ${when(r.first)} to ${when(r.last)}  sender key: ${r.sender}`);
    console.log(`  masked:  ${r.template}`);
    console.log(`  test:    { sender: 'VM-${r.sender.toUpperCase()}-S', text: ${JSON.stringify(sample(r.template))} },\n`);
  }
  process.exit(0);
}

if (cmd === 'errors') {
  // grouped crashes, each with the builds that hit it and when it last happened
  const rows = db.prepare("SELECT install_id, received_at, props FROM events WHERE name = 'error' AND received_at >= ? ORDER BY received_at").all(sinceMs);
  const g = new Map();
  for (const r of rows) {
    const p = JSON.parse(r.props);
    const k = `${p.kind}|${p.code}|${p.screen}`;
    const e = g.get(k) ?? { ...p, n: 0, installs: new Set(), builds: new Map(), last: 0 };
    e.n++; e.installs.add(r.install_id); e.last = Math.max(e.last, r.received_at);
    const b = buildAt(r.install_id, r.received_at); e.builds.set(b, (e.builds.get(b) ?? 0) + 1);
    g.set(k, e);
  }
  console.log(`Errors in the last ${days} days: ${rows.length} (${g.size} kinds)\n`);
  for (const e of [...g.values()].sort((a, b) => b.n - a.n)) {
    console.log(`${e.n}x ${e.kind} ${e.code || '(no code)'} on ${e.screen}  · ${e.installs.size} install(s) · last ${when(e.last)}`);
    for (const [b, c] of [...e.builds].sort((a, b) => b[1] - a[1])) console.log(`     ${c}x on ${b}`);
  }
  process.exit(0);
}

if (cmd === 'slow') {
  // exact screen-load times from raw events, by screen and by build, so a regression after an update shows up
  const rows = db.prepare("SELECT install_id, received_at, props FROM events WHERE name = 'screen_load' AND received_at >= ?").all(sinceMs).map((r) => ({ ...JSON.parse(r.props), build: buildAt(r.install_id, r.received_at) }));
  const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0; };
  const line = (label, xs) => `${label.padEnd(34)} n=${String(xs.length).padEnd(5)} p50 ${String(q(xs, 0.5)).padStart(5)}ms  p95 ${String(q(xs, 0.95)).padStart(5)}ms  max ${String(Math.max(...xs)).padStart(5)}ms  >1s ${Math.round((xs.filter((x) => x > 1000).length / xs.length) * 100)}%`;
  console.log(`Screen load times, last ${days} days (${rows.length} loads)\n`);
  const screens = [...new Set(rows.map((r) => r.screen))];
  for (const s of screens.sort((a, b) => q(rows.filter((r) => r.screen === b).map((r) => r.ms), 0.95) - q(rows.filter((r) => r.screen === a).map((r) => r.ms), 0.95))) {
    const xs = rows.filter((r) => r.screen === s);
    console.log(line(s, xs.map((r) => r.ms)));
    const builds = [...new Set(xs.map((r) => r.build))];
    if (builds.length > 1) for (const b of builds) console.log('  ' + line(b, xs.filter((r) => r.build === b).map((r) => r.ms)));
  }
  process.exit(0);
}

if (cmd === 'shared') {
  const list = sharedCandidates(db, days);
  console.log(`Formats shared by users in the last ${days} days: ${list.length}  (publish with: node formats-cli.mjs promote <n>)\n`);
  list.forEach((c, i) => console.log(`${i + 1}. ${c.installs} install(s), ${c.n}x  [${c.sender_key}] ${c.direction} ${c.currency}  amount: ${c.amount_re}`));
  process.exit(0);
}

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
